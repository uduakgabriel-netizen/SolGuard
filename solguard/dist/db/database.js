"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppDatabase = void 0;
// src/db/database.ts
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
/**
 * Manages the application's SQLite database connection and schema.
 * Provides a structured logging interface to the audit_log table.
 */
class AppDatabase {
    static getInstance(dbPath, verbose = false) {
        if (!AppDatabase.instance) {
            console.log(`[DB] Initializing database at: ${dbPath}`);
            AppDatabase.instance = new better_sqlite3_1.default(dbPath, { verbose: verbose ? console.log : undefined });
            AppDatabase.instance.pragma('journal_mode = WAL');
            AppDatabase.instance.pragma('foreign_keys = ON');
            AppDatabase.initializeSchema();
        }
        return AppDatabase.instance;
    }
    /**
     * Executes the initial schema setup.
     */
    static initializeSchema() {
        const db = AppDatabase.getInstance(''); // Pass empty path as it's already initialized
        console.log('[DB] Applying database schema...');
        const schema = `
      -- Stores sponsored accounts discovered by the indexer
      CREATE TABLE IF NOT EXISTS sponsored_accounts (
        account_pubkey TEXT PRIMARY KEY NOT NULL,
        creation_signature TEXT NOT NULL,
        slot INTEGER NOT NULL,
        discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        operator_pubkey TEXT NOT NULL,
        -- Stage 2: Lifecycle fields
        lifecycle_state TEXT DEFAULT 'DISCOVERED',
        lamports INTEGER,
        data_len INTEGER,
        owner_program TEXT,
        last_lifecycle_check DATETIME
      );

      -- Generic key-value store for system state, primarily for the transaction cursor
      CREATE TABLE IF NOT EXISTS system_kv_store (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );

      -- Structured audit log for complete traceability of actions and errors
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        level TEXT CHECK(level IN ('INFO', 'WARN', 'ERROR')) NOT NULL,
        message TEXT NOT NULL,
        metadata TEXT -- JSON string for additional context
      );

      -- Stage 2: Lifecycle State Transition Log
      CREATE TABLE IF NOT EXISTS lifecycle_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_pubkey TEXT NOT NULL,
        old_state TEXT NOT NULL,
        new_state TEXT NOT NULL,
        trigger_reason TEXT NOT NULL,
        evidence_payload TEXT, -- JSON snapshot of the on-chain data
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(account_pubkey) REFERENCES sponsored_accounts(account_pubkey)
      );
    `;
        db.exec(schema);
        // Simple migration to ensure existing tables have new columns
        try {
            const columns = db.pragma('table_info(sponsored_accounts)');
            const hasLifecycle = columns.some(c => c.name === 'lifecycle_state');
            if (!hasLifecycle) {
                console.log('[DB] Migrating schema: Adding lifecycle fields to sponsored_accounts...');
                db.exec(`ALTER TABLE sponsored_accounts ADD COLUMN lifecycle_state TEXT DEFAULT 'DISCOVERED'`);
                db.exec(`ALTER TABLE sponsored_accounts ADD COLUMN lamports INTEGER`);
                db.exec(`ALTER TABLE sponsored_accounts ADD COLUMN data_len INTEGER`);
                db.exec(`ALTER TABLE sponsored_accounts ADD COLUMN owner_program TEXT`);
                db.exec(`ALTER TABLE sponsored_accounts ADD COLUMN last_lifecycle_check DATETIME`);
            }
        }
        catch (e) {
            console.warn('[DB] Migration warming (non-critical):', e);
        }
        console.log('[DB] Schema applied successfully.');
    }
    /**
     * Logs a message to the audit_log table.
     * @param db - The database instance.
     * @param level - The log level.
     * @param message - The main log message.
     * @param metadata - Optional structured metadata.
     */
    static log(db, level, message, metadata) {
        try {
            db.prepare('INSERT INTO audit_log (level, message, metadata) VALUES (?, ?, ?)').run(level, message, metadata ? JSON.stringify(metadata) : null);
        }
        catch (e) {
            // If the database itself is failing, log to console as a last resort.
            console.error(`[CRITICAL] Failed to write to audit log!`, {
                originalLevel: level,
                originalMessage: message,
                originalMetadata: metadata,
                logError: e,
            });
        }
    }
    static close() {
        if (AppDatabase.instance) {
            AppDatabase.instance.close();
            console.log('[DB] Database connection closed.');
        }
    }
}
exports.AppDatabase = AppDatabase;
