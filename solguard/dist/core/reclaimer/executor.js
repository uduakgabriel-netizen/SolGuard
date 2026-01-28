"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReclaimerExecutor = void 0;
const web3_js_1 = require("@solana/web3.js");
/**
 * Executes the reclaim transactions.
 * Handles signing and network interaction.
 */
class ReclaimerExecutor {
    constructor(connection, operatorKeypair, dryRun = false) {
        this.connection = connection;
        this.operatorKeypair = operatorKeypair;
        this.dryRun = dryRun;
    }
    async executeBatch(batch) {
        if (batch.accounts.length === 0) {
            return {
                batchId: batch.id,
                success: true,
                accountsProcessed: 0,
                lamportsRecovered: 0
            };
        }
        const recoveredLamports = batch.accounts.reduce((sum, acc) => sum + acc.verifiedLamports, 0);
        if (this.dryRun) {
            console.log(`[Executor:DryRun] Simulating batch ${batch.id} with ${batch.accounts.length} accounts. Recovering ${recoveredLamports} lamports.`);
            return {
                batchId: batch.id,
                success: true,
                accountsProcessed: batch.accounts.length,
                lamportsRecovered: recoveredLamports,
                signature: 'dry-run-signature'
            };
        }
        try {
            const transaction = new web3_js_1.Transaction();
            const operatorPubkey = this.operatorKeypair.publicKey;
            // Construct instructions
            for (const acc of batch.accounts) {
                transaction.add(web3_js_1.SystemProgram.transfer({
                    fromPubkey: new web3_js_1.PublicKey(acc.account_pubkey),
                    toPubkey: operatorPubkey,
                    lamports: acc.verifiedLamports,
                }));
            }
            // Send
            const signature = await (0, web3_js_1.sendAndConfirmTransaction)(this.connection, transaction, [this.operatorKeypair], { commitment: 'confirmed' });
            return {
                batchId: batch.id,
                success: true,
                signature,
                accountsProcessed: batch.accounts.length,
                lamportsRecovered: recoveredLamports
            };
        }
        catch (e) {
            return {
                batchId: batch.id,
                success: false,
                error: e.message,
                accountsProcessed: 0,
                lamportsRecovered: 0
            };
        }
    }
}
exports.ReclaimerExecutor = ReclaimerExecutor;
