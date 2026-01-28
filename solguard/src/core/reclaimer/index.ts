import { Connection, Keypair } from '@solana/web3.js';
import Database from 'better-sqlite3';
import { AppDatabase } from '../../db/database';
import { ReclaimerFetcher } from './fetch';
import { ReclaimerVerifier } from './verify';
import { ReclaimerPlanner } from './planner';
import { ReclaimerExecutor } from './executor';
import { ReclaimerReporter } from './reporter';
import { v4 as uuidv4 } from 'uuid';

export interface ReclaimerConfig {
    dbPath: string;
    rpcUrl: string;
    dryRun: boolean;
    operatorKeypair?: Keypair;
    batchSize?: number; // How many to fetch from DB at once
}

/**
 * Stage 4: Orchestrator for Scalable Reclamation.
 * Coordinates Fetch -> Verify -> Plan -> Execute -> Report.
 */
export class ReclaimerOrchestrator {
    private readonly connection: Connection;
    private readonly db: Database.Database;
    private readonly config: ReclaimerConfig;
    private readonly workerId: string;

    private fetcher: ReclaimerFetcher;
    private verifier: ReclaimerVerifier;
    private planner: ReclaimerPlanner;
    private executor: ReclaimerExecutor;
    private reporter: ReclaimerReporter;

    constructor(config: ReclaimerConfig) {
        this.config = config;
        this.connection = new Connection(config.rpcUrl, 'confirmed');
        this.db = AppDatabase.getInstance(config.dbPath, false);
        this.workerId = `worker-${uuidv4()}`;

        // Initialize subsystems
        this.fetcher = new ReclaimerFetcher(this.db);
        this.verifier = new ReclaimerVerifier(this.connection);
        this.planner = new ReclaimerPlanner();

        // Executor needs keypair if not dry run
        const dummyKeypair = Keypair.generate(); // Safe for dry run structure
        this.executor = new ReclaimerExecutor(
            this.connection,
            config.operatorKeypair || dummyKeypair,
            config.dryRun
        );

        this.reporter = new ReclaimerReporter(this.db);
    }

    public async execute(): Promise<void> {
        console.log(`[Orchestrator] Starting reclamation (Worker: ${this.workerId})`);
        console.log(`[Orchestrator] Config: DryRun=${this.config.dryRun}, BatchSize=${this.config.batchSize || 100}`);

        if (!this.config.dryRun && !this.config.operatorKeypair) {
            throw new Error('Operator Keypair is required for live execution.');
        }

        const BATCH_SIZE = this.config.batchSize || 100;
        let running = true;

        while (running) {
            // 1. Fetch & Lock
            const candidates = this.fetcher.fetchAndLock(BATCH_SIZE, this.workerId);

            if (candidates.length === 0) {
                console.log('[Orchestrator] No more reclaimable accounts found. Exiting loop.');
                running = false;
                break;
            }

            this.reporter.recordMetrics({ total_accounts_seen: candidates.length });
            console.log(`[Orchestrator] Fetched & Locked ${candidates.length} accounts.`);

            // 2. Verify (JIT)
            const { valid, invalid } = await this.verifier.verify(candidates);

            // Handle invalid immediately
            for (const inv of invalid) {
                console.log(`[Orchestrator] Account ${inv.pubkey} invalid: ${inv.reason}`);
                this.reporter.recordSkip(inv.pubkey, inv.reason, inv.status);
            }

            if (valid.length === 0) {
                console.log('[Orchestrator] All fetched accounts were invalid. continuing...');
                continue;
            }

            // 3. Plan
            const plan = this.planner.plan(valid);
            this.reporter.recordMetrics({ total_reclaimable: valid.length });

            console.log(`[Orchestrator] Planned ${plan.batches.length} batches for ${valid.length} accounts.`);

            // 4. Exeucte & Report
            for (const batch of plan.batches) {
                const result = await this.executor.executeBatch(batch);

                if (result.success) {
                    // 5. Success
                    const pubkeys = batch.accounts.map(a => a.account_pubkey);
                    this.reporter.recordSuccess(pubkeys, result.signature || 'dry-run', result.lamportsRecovered);
                    console.log(`[Orchestrator] Batch ${result.batchId} SUCCESS. Recovered ${result.lamportsRecovered} lamports.`);
                } else {
                    // 5. Failure
                    const pubkeys = batch.accounts.map(a => a.account_pubkey);
                    this.reporter.recordFailure(pubkeys, result.error || 'Unknown Error');
                    console.error(`[Orchestrator] Batch ${result.batchId} FAILED. Error: ${result.error}`);
                }
            }
        }

        this.printMetrics();
        this.close();
    }

    private printMetrics() {
        const m = this.reporter.getMetrics();
        console.log('------------------------------------------------');
        console.log('RECLAMATION SUMMARY');
        console.log('------------------------------------------------');
        console.log(`Total Accounts Processed: ${m.total_accounts_seen}`);
        console.log(`Skipped (Invalid/Changed): ${m.skipped_accounts}`);
        console.log(`Valid for Clean:          ${m.total_reclaimable}`);
        console.log(`Successfully Reclaimed:   ${m.total_reclaimed}`);
        console.log(`Failed Transactions:      ${m.failed_transactions}`);
        console.log(`Total SOL Recovered:      ${m.total_lamports_recovered / 1_000_000_000} SOL`);
        console.log('------------------------------------------------');
    }

    public close() {
        // AppDatabase.close(); // Careful, might share connection?
        // Let CLI handle close if possible, or close here if we own it.
        // For CLI tools usually we close at end of script.
    }
}
