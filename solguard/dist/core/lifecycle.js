"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LifecycleEngine = void 0;
// src/core/lifecycle.ts
const web3_js_1 = require("@solana/web3.js");
const database_1 = require("../db/database");
/**
 * Engine for determining the on-chain lifecycle state of sponsored accounts.
 * Implements Stage 2 requirements: strictly on-chain, deterministic, no heuristics.
 */
class LifecycleEngine {
    constructor(config) {
        this.config = config;
        this.connection = new web3_js_1.Connection(config.rpcUrl, 'confirmed');
        this.db = database_1.AppDatabase.getInstance(config.dbPath, false);
    }
    log(level, message, metadata) {
        console.log(`[Lifecycle:${level}] ${message}`, metadata || '');
        if (!this.config.dryRun) {
            database_1.AppDatabase.log(this.db, level, message, metadata);
        }
    }
    /**
     * Main entry point. Scans discovered accounts and updates their lifecycle state.
     */
    async scan() {
        this.log('INFO', 'Starting lifecycle scan.', this.config);
        // Fetch all accounts that are not in a final state (or just check everything for correctness/updates)
        // For Stage 2, checking everything that is not 'RECLAIMABLE' is safest to ensure 'ACTIVE' accounts are monitored.
        // However, checking 'CLOSED' accounts is maybe redundant unless they can be reopened? (Re-initialization is possible).
        // Let's check everything for now to be "safe/auditable".
        const accounts = this.db.prepare(`SELECT account_pubkey, lifecycle_state FROM sponsored_accounts`).all();
        this.log('INFO', `Found ${accounts.length} accounts to check.`);
        // Batch processing to respect RPC limits
        const batchSize = this.config.batchSize || 100;
        for (let i = 0; i < accounts.length; i += batchSize) {
            const batch = accounts.slice(i, i + batchSize);
            await this.processBatch(batch);
        }
        this.log('INFO', 'Lifecycle scan complete.');
    }
    async processBatch(batch) {
        const pubkeys = batch.map(a => new web3_js_1.PublicKey(a.account_pubkey));
        try {
            // getMultipleAccountsInfo is more efficient
            const infos = await this.connection.getMultipleAccountsInfo(pubkeys);
            for (let i = 0; i < batch.length; i++) {
                const account = batch[i];
                const info = infos[i];
                await this.evaluateAccount(account.account_pubkey, account.lifecycle_state, info);
            }
        }
        catch (e) {
            this.log('ERROR', 'Error processing batch.', { error: e.message, batchSize: batch.length });
        }
    }
    /**
     * Evaluates the on-chain data and determines the state transition.
     */
    async evaluateAccount(pubkeyStr, currentState, info) {
        let newState = currentState;
        let reason = '';
        const evidence = {};
        if (info === null) {
            // Account does not exist on-chain.
            newState = 'CLOSED';
            reason = 'Account info is null (does not exist).';
            evidence.exists = false;
        }
        else {
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
            }
            else {
                this.recordEvent(pubkeyStr, currentState, newState, reason, evidence);
                this.log('INFO', `State transition: ${currentState} -> ${newState}`, { pubkey: pubkeyStr });
            }
        }
        else {
            // Log update (verbose) or just silent?
            // Maybe log if it's the first time processing 'DISCOVERED' -> 'ACTIVE' even if default match?
            // Actually our default in DB is 'DISCOVERED'. so 'ACTIVE' is a change.
        }
    }
    updateAccountData(pubkey, state, evidence) {
        if (this.config.dryRun)
            return;
        this.db.prepare(`UPDATE sponsored_accounts 
       SET lifecycle_state = ?,
           lamports = ?,
           data_len = ?,
           owner_program = ?,
           last_lifecycle_check = CURRENT_TIMESTAMP
       WHERE account_pubkey = ?`).run(state, evidence.lamports || 0, evidence.dataLen || 0, evidence.owner || null, pubkey);
    }
    recordEvent(pubkey, oldState, newState, reason, evidence) {
        this.db.prepare(`INSERT INTO lifecycle_events (account_pubkey, old_state, new_state, trigger_reason, evidence_payload)
       VALUES (?, ?, ?, ?, ?)`).run(pubkey, oldState, newState, reason, JSON.stringify(evidence));
    }
    close() {
        database_1.AppDatabase.close();
    }
}
exports.LifecycleEngine = LifecycleEngine;
