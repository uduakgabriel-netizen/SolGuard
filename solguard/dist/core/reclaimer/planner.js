"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReclaimerPlanner = void 0;
/**
 * Plans the execution by grouping verified accounts into optimal batches.
 * Enforces transaction size limits (Max 10 instructions/tx).
 */
class ReclaimerPlanner {
    constructor() {
        this.MAX_INSTRUCTIONS_PER_TX = 10;
    }
    /**
     * Creates a list of batches from verified accounts.
     */
    plan(accounts) {
        const batches = [];
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
exports.ReclaimerPlanner = ReclaimerPlanner;
