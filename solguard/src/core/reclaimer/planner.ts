import { VerifiedAccount } from './verify';

export interface ReclaimPlan {
    batches: ReclaimBatch[];
}

export interface ReclaimBatch {
    id: string; // Unique ID for the batch (for logging)
    accounts: VerifiedAccount[];
}

/**
 * Plans the execution by grouping verified accounts into optimal batches.
 * Enforces transaction size limits (Max 10 instructions/tx).
 */
export class ReclaimerPlanner {
    private readonly MAX_INSTRUCTIONS_PER_TX = 10;

    /**
     * Creates a list of batches from verified accounts.
     */
    public plan(accounts: VerifiedAccount[]): ReclaimPlan {
        const batches: ReclaimBatch[] = [];

        let batchId = 0;
        for (let i = 0; i < accounts.length; i += this.MAX_INSTRUCTIONS_PER_TX) {
            const chunk = accounts.slice(i, i + this.MAX_INSTRUCTIONS_PER_TX);
            batches.push({
                id: `batch-${Date.now()}-${batchId++}`,
                accounts: chunk
            });
        }

        return { batches };
    }
}
