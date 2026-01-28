import Database from 'better-sqlite3';

export interface Metrics {
    total_accounts_seen: number;
    total_reclaimable: number;
    total_reclaimed: number;
    total_lamports_recovered: number;
    failed_transactions: number;
    skipped_accounts: number;
}

export class ReclaimerReporter {
    private readonly db: Database.Database;
    private metrics: Metrics;

    constructor(db: Database.Database) {
        this.db = db;
        this.metrics = {
            total_accounts_seen: 0,
            total_reclaimable: 0,
            total_reclaimed: 0,
            total_lamports_recovered: 0,
            failed_transactions: 0,
            skipped_accounts: 0
        };
    }

    public recordMetrics(update: Partial<Metrics>) {
        // Accumulate in-memory for the run session
        this.metrics = {
            total_accounts_seen: this.metrics.total_accounts_seen + (update.total_accounts_seen || 0),
            total_reclaimable: this.metrics.total_reclaimable + (update.total_reclaimable || 0),
            total_reclaimed: this.metrics.total_reclaimed + (update.total_reclaimed || 0),
            total_lamports_recovered: this.metrics.total_lamports_recovered + (update.total_lamports_recovered || 0),
            failed_transactions: this.metrics.failed_transactions + (update.failed_transactions || 0),
            skipped_accounts: this.metrics.skipped_accounts + (update.skipped_accounts || 0),
        };
    }

    public getMetrics(): Metrics {
        return { ...this.metrics };
    }

    public recordUnlock(pubkeys: string[]) {
        // Logic handled in fetcher.unlock, but reporter might want to log this?
    }

    public recordSkip(pubkey: string, reason: string, status: string = 'SKIPPED') {
        try {
            this.db.prepare(
                `UPDATE sponsored_accounts 
                 SET lifecycle_state = ?, processing_lock = NULL 
                 WHERE account_pubkey = ?`
            ).run(status, pubkey);

            this.db.prepare(
                `INSERT INTO lifecycle_events (account_pubkey, old_state, new_state, trigger_reason, evidence_payload)
                 VALUES (?, 'RECLAIMABLE', ?, ?, ?)`
            ).run(pubkey, status, reason, JSON.stringify({ timestamp: Date.now() }));

            this.recordMetrics({ skipped_accounts: 1 });
        } catch (e) {
            console.error(`[Reporter] Failed to record skip for ${pubkey}:`, e);
        }
    }

    public recordSuccess(pubkeys: string[], signature: string, lamports: number) {
        try {
            const updateStmt = this.db.prepare(
                `UPDATE sponsored_accounts 
                 SET lifecycle_state = 'RECLAIMED', 
                     lamports = 0, 
                     processing_lock = NULL 
                 WHERE account_pubkey = ?`
            );

            const eventStmt = this.db.prepare(
                `INSERT INTO lifecycle_events (account_pubkey, old_state, new_state, trigger_reason, evidence_payload)
                 VALUES (?, 'RECLAIMABLE', 'RECLAIMED', 'Reclamation Success', ?)`
            );

            const transaction = this.db.transaction(() => {
                for (const pubkey of pubkeys) {
                    updateStmt.run(pubkey);
                    eventStmt.run(pubkey, JSON.stringify({ signature, batchTotal: lamports }));
                }
            });
            transaction();

            this.recordMetrics({
                total_reclaimed: pubkeys.length,
                total_lamports_recovered: lamports
            });

        } catch (e) {
            console.error(`[Reporter] Failed to record success for batch ${signature}:`, e);
            // In a real scenario, this is critical.
        }
    }

    public recordFailure(pubkeys: string[], error: string) {
        try {
            const updateStmt = this.db.prepare(
                `UPDATE sponsored_accounts 
                 SET lifecycle_state = 'FAILED', 
                     processing_lock = NULL 
                 WHERE account_pubkey = ?`
            );

            const eventStmt = this.db.prepare(
                `INSERT INTO lifecycle_events (account_pubkey, old_state, new_state, trigger_reason, evidence_payload)
                 VALUES (?, 'RECLAIMABLE', 'FAILED', ?, ?)`
            );

            const transaction = this.db.transaction(() => {
                for (const pubkey of pubkeys) {
                    // Update state to FAILED so we don't retry indefinitely without intervention, or keep as RECLAIMABLE?
                    // Directive says "If process crashes... resume without double spending".
                    // But if tx fails (e.g. blockhash expiry), we might want to retry.
                    // However, safe default is FAILED or RECLAIMABLE with null lock. 
                    // Let's mark FAILED for manual review as per safety first.
                    updateStmt.run(pubkey);
                    eventStmt.run(pubkey, `Tx Error: ${error}`, JSON.stringify({ timestamp: Date.now() }));
                }
            });
            transaction();

            this.recordMetrics({ failed_transactions: 1 });

        } catch (e) {
            console.error(`[Reporter] Failed to record failure for batch:`, e);
        }
    }
}
