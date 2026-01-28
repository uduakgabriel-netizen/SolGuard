import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

export interface ReclaimableAccount {
    account_pubkey: string;
    lamports: number;
}

/**
 * Fetches a batch of reclaimable accounts and locks them for processing.
 * Implements cursor-based pagination and idempotency via locking.
 */
export class ReclaimerFetcher {
    private readonly db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
    }

    /**
     * Fetches up to `limit` accounts that are RECLAIMABLE and not currently locked.
     * Sets a `processing_lock` on them to prevent double-processing.
     * @param limit Maximum number of accounts to fetch
     * @param workerId Unique ID for this worker/process to own the lock
     * @returns Array of locked accounts ready for processing
     */
    public fetchAndLock(limit: number, workerId: string): ReclaimableAccount[] {
        // 1. Identify candidates (using limit)
        // We use a transaction to ensure we only get clients we successfully locked
        const fetchTransaction = this.db.transaction(() => {
            // Find candidates that are RECLAIMABLE and NOT locked
            const candidates = this.db.prepare(
                `SELECT account_pubkey, lamports 
                 FROM sponsored_accounts 
                 WHERE lifecycle_state = 'RECLAIMABLE' 
                   AND (processing_lock IS NULL OR processing_lock = '')
                 LIMIT ?`
            ).all(limit) as ReclaimableAccount[];

            if (candidates.length === 0) {
                return [];
            }

            const pubkeys = candidates.map(c => c.account_pubkey);

            // Lock them
            const updateStmt = this.db.prepare(
                `UPDATE sponsored_accounts 
                 SET processing_lock = ? 
                 WHERE account_pubkey = ?`
            );

            for (const pubkey of pubkeys) {
                updateStmt.run(workerId, pubkey);
            }

            return candidates;
        });

        return fetchTransaction();
    }

    /**
     * Unlocks accounts that were locked but not processed (e.g. if we crash or skip them).
     * @param pubkeys List of account pubkeys to unlock
     */
    public unlock(pubkeys: string[]): void {
        if (pubkeys.length === 0) return;

        const unlockStmt = this.db.prepare(
            `UPDATE sponsored_accounts SET processing_lock = NULL WHERE account_pubkey = ?`
        );

        const transaction = this.db.transaction(() => {
            for (const pubkey of pubkeys) {
                unlockStmt.run(pubkey);
            }
        });

        transaction();
    }
}
