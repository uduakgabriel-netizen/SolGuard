import { Connection, Keypair, Transaction, SystemProgram, sendAndConfirmTransaction, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { ReclaimBatch } from './planner';

export interface ExecutionResult {
    batchId: string;
    signature?: string;
    error?: string;
    success: boolean;
    accountsProcessed: number;
    lamportsRecovered: number;
}

/**
 * Executes the reclaim transactions.
 * Handles signing and network interaction.
 */
export class ReclaimerExecutor {
    private readonly connection: Connection;
    private readonly operatorKeypair: Keypair;
    private readonly dryRun: boolean;

    constructor(connection: Connection, operatorKeypair: Keypair, dryRun: boolean = false) {
        this.connection = connection;
        this.operatorKeypair = operatorKeypair;
        this.dryRun = dryRun;
    }

    public async executeBatch(batch: ReclaimBatch): Promise<ExecutionResult> {
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
            const transaction = new Transaction();
            const operatorPubkey = this.operatorKeypair.publicKey;

            // Construct instructions
            for (const acc of batch.accounts) {
                transaction.add(
                    SystemProgram.transfer({
                        fromPubkey: new PublicKey(acc.account_pubkey),
                        toPubkey: operatorPubkey,
                        lamports: acc.verifiedLamports,
                    })
                );
            }

            // Send
            const signature = await sendAndConfirmTransaction(
                this.connection,
                transaction,
                [this.operatorKeypair],
                { commitment: 'confirmed' }
            );

            return {
                batchId: batch.id,
                success: true,
                signature,
                accountsProcessed: batch.accounts.length,
                lamportsRecovered: recoveredLamports
            };

        } catch (e: any) {
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
