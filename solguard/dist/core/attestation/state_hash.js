"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateHasher = void 0;
const crypto_1 = __importDefault(require("crypto"));
const utils_1 = require("./utils");
class StateHasher {
    constructor(db) {
        this.db = db;
    }
    /**
     * Computes a deterministic Merkle-like hash of the relevant database tables.
     * Captures the state of:
     * - sponsored_accounts (ordered by pubkey)
     * - lifecycle_events (ordered by id)
     */
    computeStateHash() {
        const sponsoredHash = this.hashTable('sponsored_accounts', 'SELECT * FROM sponsored_accounts ORDER BY account_pubkey ASC');
        const lifecycleHash = this.hashTable('lifecycle_events', 'SELECT * FROM lifecycle_events ORDER BY id ASC');
        // Combine table hashes into a root hash
        return crypto_1.default
            .createHash('sha256')
            .update(sponsoredHash)
            .update(lifecycleHash)
            .digest('hex');
    }
    hashTable(tableName, query) {
        const rows = this.db.prepare(query).all();
        // If table is empty, return hash of empty string or specific constant
        if (rows.length === 0) {
            return crypto_1.default.createHash('sha256').update(`${tableName}:empty`).digest('hex');
        }
        const tableHasher = crypto_1.default.createHash('sha256');
        for (const row of rows) {
            // Nulls should be consistently handled by JSON.stringify
            // We use canonicalize to ensure column order doesn't matter (though SQLite usually returns fixed order)
            const rowStr = JSON.stringify((0, utils_1.canonicalize)(row));
            const rowHash = crypto_1.default.createHash('sha256').update(rowStr).digest();
            tableHasher.update(rowHash);
        }
        return tableHasher.digest('hex');
    }
}
exports.StateHasher = StateHasher;
