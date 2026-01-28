// src/core/reclaimer.ts
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import Database from 'better-sqlite3';
import { AppDatabase, LogLevel } from '../db/database';

export interface ReclaimerConfig {
    dbPath: string;
    rpcUrl: string;
    dryRun: boolean;
    operatorKeypair?: Keypair; // Optional for dry-run
    batchSize?: number;
}

/**
 * Executes the reclamation of SOL from RECLAIMABLE accounts.
 * Safe, idempotent, and audited.
 */
export class Reclaimer {
    private readonly connection: Connection;
    private readonly db: Database.Database;
    private readonly config: ReclaimerConfig;

    constructor(config: ReclaimerConfig) {
        this.config = config;
        this.connection = new Connection(config.rpcUrl, 'confirmed');
        this.db = AppDatabase.getInstance(config.dbPath, false);
    }

    private log(level: LogLevel, message: string, metadata?: object) {
        console.log(`[Reclaimer:${level}] ${message}`, metadata || '');
        if (!this.config.dryRun) {
            AppDatabase.log(this.db, level, message, metadata);
        }
    }

    /**
     * Main entry point to execute reclamation.
     */
    public async execute(): Promise<void> {
        this.log('INFO', 'Starting reclamation process...', { dryRun: this.config.dryRun });

        if (!this.config.dryRun && !this.config.operatorKeypair) {
            throw new Error('Operator Keypair is required for live execution.');
        }

        // 1. Fetch RECLAIMABLE accounts
        const targets = this.db.prepare(
            `SELECT * FROM sponsored_accounts WHERE lifecycle_state = 'RECLAIMABLE'`
        ).all() as any[];

        if (targets.length === 0) {
            this.log('INFO', 'No accounts marked RECLAIMABLE. Nothing to do.');
            return;
        }

        this.log('INFO', `Found ${targets.length} RECLAIMABLE accounts.`);

        // 2. Process in batches (safe and efficient)
        const BATCH_SIZE = this.config.batchSize || 10;

        // Chunk targets into batches
        for (let i = 0; i < targets.length; i += BATCH_SIZE) {
            const batch = targets.slice(i, i + BATCH_SIZE);
            await this.processBatch(batch);
        }

        this.log('INFO', 'Reclamation process finished.');
    }

    /**
     * Processes a batch of accounts to reclaim.
     * Groups instructions into a single transaction if possible.
     */
    /**
     * Processes a batch of accounts to reclaim.
     * "Just-In-Time On-Chain Verification (MANDATORY)"
     */
    private async processBatch(accounts: any[]): Promise<void> {
        if (this.config.dryRun) {
            this.log('INFO', `[Dry Run] Processing batch of ${accounts.length} accounts.`);
            // In dry-run, we still want to verify what *would* happen if possible, but without keys we might fail sigs.
            // The directive says: "When enabled: Build instructions, Simulate, LOG expected lamports".
            // We will proceed to fetch info to be accurate.
        }

        const operator = this.config.operatorKeypair ? this.config.operatorKeypair.publicKey : new PublicKey('11111111111111111111111111111111'); // Dummy for dry-run if missing

        // VERIFICATION: Fetch current on-chain state for this batch
        // "Use getMultipleAccountsInfo for batched queries"
        const pubkeys = accounts.map(a => new PublicKey(a.account_pubkey));
        const accountInfos = await this.connection.getMultipleAccountsInfo(pubkeys);

        const validAccounts: any[] = [];
        const transaction = new Transaction();

        const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

        for (let i = 0; i < accounts.length; i++) {
            const acc = accounts[i];
            const info = accountInfos[i];

            // Re-validate: Account not found -> Mark CLOSED
            if (!info) {
                this.log('WARN', `Account ${acc.account_pubkey} is null on-chain. Marking as CLOSED.`);
                this.markOutcome(acc.account_pubkey, 'closed_zero', 'JIT: Account not found');
                continue;
            }

            // Re-validate: lamports === 0 -> Mark CLOSED
            if (info.lamports === 0) {
                this.log('WARN', `Account ${acc.account_pubkey} has 0 lamports. Marking CLOSED.`);
                this.markOutcome(acc.account_pubkey, 'closed_zero', 'JIT: 0 Lamports');
                continue;
            }

            // Re-validate: owner != SystemProgram -> Mark SKIPPED
            if (info.owner.toBase58() !== SYSTEM_PROGRAM_ID) {
                this.log('WARN', `Account ${acc.account_pubkey} owner changed to ${info.owner.toBase58()}. Marking SKIPPED.`);
                this.markOutcome(acc.account_pubkey, 'SKIPPED', `JIT: Owner Changed to ${info.owner.toBase58()}`);
                continue;
            }

            // Re-validate: data_len > 0 -> Mark SKIPPED
            if (info.data.length > 0) {
                this.log('WARN', `Account ${acc.account_pubkey} has data. Marking SKIPPED.`);
                this.markOutcome(acc.account_pubkey, 'SKIPPED', `JIT: Data len ${info.data.length} > 0`);
                continue;
            }

            // Use the ACTUAL on-chain balance
            const balance = info.lamports;
            const pubkey = new PublicKey(acc.account_pubkey);

            if (this.config.dryRun) {
                this.log('INFO', `[Dry Run] Would transfer ${balance} lamports from ${acc.account_pubkey} to operator.`);
                continue;
            }

            // Instruction: Generic Transfer
            transaction.add(
                SystemProgram.transfer({
                    fromPubkey: pubkey,
                    toPubkey: operator,
                    lamports: balance,
                })
            );

            validAccounts.push({ ...acc, lamports: balance });
        }

        if (this.config.dryRun) return;

        if (validAccounts.length === 0) {
            this.log('INFO', 'No valid eligible accounts in this batch after on-chain verification.');
            return;
        }

        try {
            // Send the batch
            const signature = await sendAndConfirmTransaction(
                this.connection,
                transaction,
                [this.config.operatorKeypair!],
                { commitment: 'confirmed' }
            );

            this.log('INFO', `Batch reclaim successful! Signature: ${signature}`, { count: validAccounts.length });

            // Update DB for all successful accounts: RECLAIMED
            for (const acc of validAccounts) {
                this.recordReclaimSuccess(acc.account_pubkey, signature, acc.lamports);
            }

        } catch (e: any) {
            this.log('ERROR', `Batch reclaim failed. Marking accounts as FAILED.`, { error: e.message });
            // "If still fails -> mark accounts as FAILED"
            for (const acc of validAccounts) {
                this.markOutcome(acc.account_pubkey, 'FAILED', `Tx Error: ${e.message}`);
            }
        }
    }

    private markOutcome(pubkey: string, state: string, reason: string): void {
        if (this.config.dryRun) return;

        this.db.prepare(
            `UPDATE sponsored_accounts SET lifecycle_state = ? WHERE account_pubkey = ?`
        ).run(state, pubkey);

        this.db.prepare(
            `INSERT INTO lifecycle_events (account_pubkey, old_state, new_state, trigger_reason, evidence_payload)
         VALUES (?, 'RECLAIMABLE', ?, ?, ?)`
        ).run(pubkey, state, reason, JSON.stringify({ timestamp: Date.now() }));
    }

    private recordReclaimSuccess(pubkey: string, signature: string, amount: number): void {
        if (this.config.dryRun) return;

        this.db.prepare(
            `UPDATE sponsored_accounts SET lifecycle_state = 'RECLAIMED', lamports = 0 WHERE account_pubkey = ?`
        ).run(pubkey);

        this.db.prepare(
            `INSERT INTO lifecycle_events (account_pubkey, old_state, new_state, trigger_reason, evidence_payload)
         VALUES (?, 'RECLAIMABLE', 'RECLAIMED', 'Reclamation Success', ?)`
        ).run(pubkey, JSON.stringify({ signature, amount, slot: 'confirmed' }));
    }

    public close(): void {
        AppDatabase.close();
    }
}
