import Database from 'better-sqlite3';
import crypto from 'crypto';
import { canonicalize } from './utils';

export class StateHasher {
    constructor(private db: Database.Database) { }

    /**
     * Computes a deterministic Merkle-like hash of the relevant database tables.
     * Captures the state of:
     * - sponsored_accounts (ordered by pubkey)
     * - lifecycle_events (ordered by id)
     */
    public computeStateHash(): string {
        const sponsoredHash = this.hashTable(
            'sponsored_accounts',
            'SELECT * FROM sponsored_accounts ORDER BY account_pubkey ASC'
        );

        const lifecycleHash = this.hashTable(
            'lifecycle_events',
            'SELECT * FROM lifecycle_events ORDER BY id ASC'
        );

        // Combine table hashes into a root hash
        return crypto
            .createHash('sha256')
            .update(sponsoredHash)
            .update(lifecycleHash)
            .digest('hex');
    }

    private hashTable(tableName: string, query: string): string {
        const rows = this.db.prepare(query).all();

        // If table is empty, return hash of empty string or specific constant
        if (rows.length === 0) {
            return crypto.createHash('sha256').update(`${tableName}:empty`).digest('hex');
        }

        const tableHasher = crypto.createHash('sha256');

        for (const row of rows) {
            // Nulls should be consistently handled by JSON.stringify
            // We use canonicalize to ensure column order doesn't matter (though SQLite usually returns fixed order)
            const rowStr = JSON.stringify(canonicalize(row));
            const rowHash = crypto.createHash('sha256').update(rowStr).digest();
            tableHasher.update(rowHash);
        }

        return tableHasher.digest('hex');
    }
}
