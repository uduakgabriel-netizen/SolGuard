// src/core/lifecycle.ts
import { Connection, PublicKey } from '@solana/web3.js';
import Database from 'better-sqlite3';
import { AppDatabase, LogLevel, LifecycleState } from '../db/database';

export interface LifecycleConfig {
    rpcUrl: string;
    dbPath: string;
    dryRun: boolean;
    batchSize?: number;
}

/**
 * Engine for determining the on-chain lifecycle state of sponsored accounts.
 * Implements Stage 2 requirements: strictly on-chain, deterministic, no heuristics.
 */
export class LifecycleEngine {
    private readonly connection: Connection;
    private readonly db: Database.Database;
    private readonly config: LifecycleConfig;

    constructor(config: LifecycleConfig) {
        this.config = config;
        this.connection = new Connection(config.rpcUrl, 'confirmed');
        this.db = AppDatabase.getInstance(config.dbPath, false);
    }

    private log(level: LogLevel, message: string, metadata?: object) {
        console.log(`[Lifecycle:${level}] ${message}`, metadata || '');
        if (!this.config.dryRun) {
            AppDatabase.log(this.db, level, message, metadata);
        }
    }

    /**
     * Main entry point. Scans discovered accounts and updates their lifecycle state.
     */
    public async scan(): Promise<void> {
        this.log('INFO', 'Starting lifecycle scan.', this.config);

        // Fetch all accounts that are not in a final state (or just check everything for correctness/updates)
        // For Stage 2, checking everything that is not 'RECLAIMABLE' is safest to ensure 'ACTIVE' accounts are monitored.
        // However, checking 'CLOSED' accounts is maybe redundant unless they can be reopened? (Re-initialization is possible).
        // Let's check everything for now to be "safe/auditable".
        const accounts = this.db.prepare(
            `SELECT account_pubkey, lifecycle_state FROM sponsored_accounts`
        ).all() as { account_pubkey: string; lifecycle_state: LifecycleState }[];

        this.log('INFO', `Found ${accounts.length} accounts to check.`);

        // Batch processing to respect RPC limits
        const batchSize = this.config.batchSize || 100;
        for (let i = 0; i < accounts.length; i += batchSize) {
            const batch = accounts.slice(i, i + batchSize);
            await this.processBatch(batch);
        }

        this.log('INFO', 'Lifecycle scan complete.');
    }

    private async processBatch(batch: { account_pubkey: string; lifecycle_state: LifecycleState }[]): Promise<void> {
        const pubkeys = batch.map(a => new PublicKey(a.account_pubkey));

        try {
            // getMultipleAccountsInfo is more efficient
            const infos = await this.connection.getMultipleAccountsInfo(pubkeys);

            for (let i = 0; i < batch.length; i++) {
                const account = batch[i];
                const info = infos[i];
                await this.evaluateAccount(account.account_pubkey, account.lifecycle_state, info);
            }

        } catch (e: any) {
            this.log('ERROR', 'Error processing batch.', { error: e.message, batchSize: batch.length });
        }
    }

    /**
     * Evaluates the on-chain data and determines the state transition.
     */
    private async evaluateAccount(
        pubkeyStr: string,
        currentState: LifecycleState,
        info: dynamo_types.AccountInfo<Buffer> | null
    ): Promise<void> {

        let newState: LifecycleState = currentState;
        let reason = '';
        const evidence: any = {};

        if (info === null) {
            // Account does not exist on-chain.
            newState = 'CLOSED';
            reason = 'Account info is null (does not exist).';
            evidence.exists = false;
        } else {
            // Account exists.
            evidence.exists = true;
            evidence.lamports = info.lamports;
            evidence.dataLen = info.data.length;
            evidence.owner = info.owner.toBase58();
            evidence.executable = info.executable;
            evidence.rentEpoch = info.rentEpoch; // Note: type definition might vary, usually number

            const rentExemptMin = await this.connection.getMinimumBalanceForRentExemption(info.data.length);
            evidence.rentExemptMin = rentExemptMin;
            evidence.isRentExempt = info.lamports >= rentExemptMin;

            // Rule: "If exists -> ACTIVE" (unless user policy defines DORMANT later, but for now, existence = ACTIVE)
            // Note: We do NOT reclaim here.
            // We do NOT assume 'DORMANT' without heuristcs.
            // So if it exists, it is ACTIVE.
            // Start with ACTIVE.
            newState = 'ACTIVE';
            reason = 'Account exists on-chain.';

            // If the state was ALREADY Closed, and now it exists, it was likely re-opened/re-initialized.
            if (currentState === 'CLOSED') {
                reason = 'Account re-appeared on-chain (re-initialized).';
            }
        }

        // Persist the observed data regardless of state change
        this.updateAccountData(pubkeyStr, newState, evidence);

        // If state changed, log the event
        if (newState !== currentState) {
            if (this.config.dryRun) {
                this.log('INFO', `[Dry Run] State transition: ${currentState} -> ${newState}`, { pubkey: pubkeyStr, reason });
            } else {
                this.recordEvent(pubkeyStr, currentState, newState, reason, evidence);
                this.log('INFO', `State transition: ${currentState} -> ${newState}`, { pubkey: pubkeyStr });
            }
        } else {
            // Log update (verbose) or just silent?
            // Maybe log if it's the first time processing 'DISCOVERED' -> 'ACTIVE' even if default match?
            // Actually our default in DB is 'DISCOVERED'. so 'ACTIVE' is a change.
        }
    }

    private updateAccountData(pubkey: string, state: LifecycleState, evidence: any): void {
        if (this.config.dryRun) return;

        this.db.prepare(
            `UPDATE sponsored_accounts 
       SET lifecycle_state = ?,
           lamports = ?,
           data_len = ?,
           owner_program = ?,
           last_lifecycle_check = CURRENT_TIMESTAMP
       WHERE account_pubkey = ?`
        ).run(
            state,
            evidence.lamports || 0,
            evidence.dataLen || 0,
            evidence.owner || null,
            pubkey
        );
    }

    private recordEvent(
        pubkey: string,
        oldState: LifecycleState,
        newState: LifecycleState,
        reason: string,
        evidence: any
    ): void {
        this.db.prepare(
            `INSERT INTO lifecycle_events (account_pubkey, old_state, new_state, trigger_reason, evidence_payload)
       VALUES (?, ?, ?, ?, ?)`
        ).run(
            pubkey,
            oldState,
            newState,
            reason,
            JSON.stringify(evidence)
        );
    }

    public close(): void {
        AppDatabase.close();
    }
}

// Helper for type safety if needed, though simple implicit any for account info works with web3.js types usually
namespace dynamo_types {
    export interface AccountInfo<T> {
        /** `true` if this account's data contains a loaded program */
        executable: boolean;
        /** Identifier of the program that owns this account */
        owner: PublicKey;
        /** Number of lamports assigned to this account */
        lamports: number;
        /** Optional data assigned to this account */
        data: T;
        /** Optional rent epoch info for this account */
        rentEpoch?: number;
    }
}
