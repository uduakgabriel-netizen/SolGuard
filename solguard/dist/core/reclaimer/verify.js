"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReclaimerVerifier = void 0;
const web3_js_1 = require("@solana/web3.js");
/**
 * Performs Just-In-Time (JIT) on-chain verification of accounts.
 * Ensures we only attempt reclaim on valid, existing, empty, system-owned accounts.
 */
class ReclaimerVerifier {
    constructor(connection) {
        this.SYSTEM_PROGRAM_ID = new web3_js_1.PublicKey('11111111111111111111111111111111');
        this.connection = connection;
    }
    async verify(accounts) {
        if (accounts.length === 0) {
            return { valid: [], invalid: [] };
        }
        const pubkeys = accounts.map(a => new web3_js_1.PublicKey(a.account_pubkey));
        // Batch fetch on-chain info
        const accountInfos = await this.connection.getMultipleAccountsInfo(pubkeys);
        const valid = [];
        const invalid = [];
        for (let i = 0; i < accounts.length; i++) {
            const acc = accounts[i];
            const info = accountInfos[i];
            const pubkeyStr = acc.account_pubkey;
            // 1. Check existence
            if (!info) {
                invalid.push({
                    pubkey: pubkeyStr,
                    reason: 'Account does not exist on-chain',
                    status: 'closed_zero' // It's gone, so technically closed
                });
                continue;
            }
            // 2. Check balance > 0
            if (info.lamports === 0) {
                invalid.push({
                    pubkey: pubkeyStr,
                    reason: 'Account has 0 lamports',
                    status: 'closed_zero'
                });
                continue;
            }
            // 3. Check Owner == System Program
            if (!info.owner.equals(this.SYSTEM_PROGRAM_ID)) {
                invalid.push({
                    pubkey: pubkeyStr,
                    reason: `Owner changed to ${info.owner.toBase58()}`,
                    status: 'SKIPPED' // Someone else owns it now? Skip safely.
                });
                continue;
            }
            // 4. Check Data Length == 0 (System accounts shouldn't have data usually, unless it's a specific system account type? 
            // Standard system accounts (wallets) have 0 data. If it has data, it might be something else ?)
            if (info.data.length > 0) {
                invalid.push({
                    pubkey: pubkeyStr,
                    reason: `Account has data len ${info.data.length}`,
                    status: 'SKIPPED'
                });
                continue;
            }
            // Valid
            valid.push({
                account_pubkey: pubkeyStr,
                lamports: acc.lamports, // Keep DB value? No, use on-chain value!
                verifiedLamports: info.lamports
            });
        }
        return { valid, invalid };
    }
}
exports.ReclaimerVerifier = ReclaimerVerifier;
