"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Reclaimer = void 0;
// src/core/reclaimer.ts
const web3_js_1 = require("@solana/web3.js");
const database_1 = require("../db/database");
/**
 * Executes the reclamation of SOL from RECLAIMABLE accounts.
 * Safe, idempotent, and audited.
 */
class Reclaimer {
    constructor(config) {
        this.config = config;
        this.connection = new web3_js_1.Connection(config.rpcUrl, 'confirmed');
        this.db = database_1.AppDatabase.getInstance(config.dbPath, false);
    }
    log(level, message, metadata) {
        console.log(`[Reclaimer:${level}] ${message}`, metadata || '');
        if (!this.config.dryRun) {
            database_1.AppDatabase.log(this.db, level, message, metadata);
        }
    }
    /**
     * Main entry point to execute reclamation.
     */
    async execute() {
        this.log('INFO', 'Starting reclamation process...', { dryRun: this.config.dryRun });
        if (!this.config.dryRun && !this.config.operatorKeypair) {
            throw new Error('Operator Keypair is required for live execution.');
        }
        // 1. Fetch RECLAIMABLE accounts
        const targets = this.db.prepare(`SELECT * FROM sponsored_accounts WHERE lifecycle_state = 'RECLAIMABLE'`).all();
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
    async processBatch(accounts) {
        if (this.config.dryRun) {
            this.log('INFO', `[Dry Run] Processing batch of ${accounts.length} accounts.`);
            // In dry-run, we still want to verify what *would* happen if possible, but without keys we might fail sigs.
            // The directive says: "When enabled: Build instructions, Simulate, LOG expected lamports".
            // We will proceed to fetch info to be accurate.
        }
        const operator = this.config.operatorKeypair ? this.config.operatorKeypair.publicKey : new web3_js_1.PublicKey('11111111111111111111111111111111'); // Dummy for dry-run if missing
        // VERIFICATION: Fetch current on-chain state for this batch
        // "Use getMultipleAccountsInfo for batched queries"
        const pubkeys = accounts.map(a => new web3_js_1.PublicKey(a.account_pubkey));
        const accountInfos = await this.connection.getMultipleAccountsInfo(pubkeys);
        const validAccounts = [];
        const transaction = new web3_js_1.Transaction();
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
            const pubkey = new web3_js_1.PublicKey(acc.account_pubkey);
            if (this.config.dryRun) {
                this.log('INFO', `[Dry Run] Would transfer ${balance} lamports from ${acc.account_pubkey} to operator.`);
                continue;
            }
            // Instruction: Generic Transfer
            transaction.add(web3_js_1.SystemProgram.transfer({
                fromPubkey: pubkey,
                toPubkey: operator,
                lamports: balance,
            }));
            validAccounts.push({ ...acc, lamports: balance });
        }
        if (this.config.dryRun)
            return;
        if (validAccounts.length === 0) {
            this.log('INFO', 'No valid eligible accounts in this batch after on-chain verification.');
            return;
        }
        try {
            // Send the batch
            const signature = await (0, web3_js_1.sendAndConfirmTransaction)(this.connection, transaction, [this.config.operatorKeypair], { commitment: 'confirmed' });
            this.log('INFO', `Batch reclaim successful! Signature: ${signature}`, { count: validAccounts.length });
            // Update DB for all successful accounts: RECLAIMED
            for (const acc of validAccounts) {
                this.recordReclaimSuccess(acc.account_pubkey, signature, acc.lamports);
            }
        }
        catch (e) {
            this.log('ERROR', `Batch reclaim failed. Marking accounts as FAILED.`, { error: e.message });
            // "If still fails -> mark accounts as FAILED"
            for (const acc of validAccounts) {
                this.markOutcome(acc.account_pubkey, 'FAILED', `Tx Error: ${e.message}`);
            }
        }
    }
    markOutcome(pubkey, state, reason) {
        if (this.config.dryRun)
            return;
        this.db.prepare(`UPDATE sponsored_accounts SET lifecycle_state = ? WHERE account_pubkey = ?`).run(state, pubkey);
        this.db.prepare(`INSERT INTO lifecycle_events (account_pubkey, old_state, new_state, trigger_reason, evidence_payload)
         VALUES (?, 'RECLAIMABLE', ?, ?, ?)`).run(pubkey, state, reason, JSON.stringify({ timestamp: Date.now() }));
    }
    recordReclaimSuccess(pubkey, signature, amount) {
        if (this.config.dryRun)
            return;
        this.db.prepare(`UPDATE sponsored_accounts SET lifecycle_state = 'RECLAIMED', lamports = 0 WHERE account_pubkey = ?`).run(pubkey);
        this.db.prepare(`INSERT INTO lifecycle_events (account_pubkey, old_state, new_state, trigger_reason, evidence_payload)
         VALUES (?, 'RECLAIMABLE', 'RECLAIMED', 'Reclamation Success', ?)`).run(pubkey, JSON.stringify({ signature, amount, slot: 'confirmed' }));
    }
    close() {
        database_1.AppDatabase.close();
    }
}
exports.Reclaimer = Reclaimer;
