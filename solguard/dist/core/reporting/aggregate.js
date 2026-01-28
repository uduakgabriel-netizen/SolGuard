"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsAggregator = void 0;
class MetricsAggregator {
    constructor(db) {
        this.db = db;
    }
    getGlobalMetrics() {
        // 1. Total Discovered
        const totalDiscovered = this.db.prepare(`SELECT COUNT(*) as count FROM sponsored_accounts`).pluck().get();
        // 2. State Breakdown
        const stateRows = this.db.prepare(`SELECT lifecycle_state, COUNT(*) as count FROM sponsored_accounts GROUP BY lifecycle_state`).all();
        const stateCounts = {};
        let totalEvaluated = 0;
        for (const row of stateRows) {
            stateCounts[row.lifecycle_state] = row.count;
            if (row.lifecycle_state !== 'DISCOVERED') {
                totalEvaluated += row.count;
            }
        }
        // 3. Reclaimed Lamports (Sum from events evidence or diff? Better from successful events)
        // We look at lifecycle_events where new_state = 'RECLAIMED' and evidence_payload has amount
        // Evidence payload is JSON string. JSON_EXTRACT in sqlite might work if widely available, 
        // but better safe to fetch and sum in JS if volume isn't massive. 
        // Or simpler: We don't have a 'reclaimed_amount' column. 
        // Let's iterate events for accuracy.
        const reclaimEvents = this.db.prepare(`SELECT evidence_payload FROM lifecycle_events WHERE new_state = 'RECLAIMED'`).all();
        let totalLamports = 0;
        let reclaimCount = 0;
        for (const event of reclaimEvents) {
            try {
                const evidence = JSON.parse(event.evidence_payload);
                // reporter.ts saves: { signature, amount, slot }
                // or { signature, batchTotal } in recent code. 
                // Let's check reporter.ts: 
                // `eventStmt.run(pubkey, JSON.stringify({ signature, batchTotal: lamports }));`
                // Wait, batchTotal implies the total for the batch, but we run this PER pubkey in the loop?
                // Reporter.ts: 
                // `for (const pubkey of pubkeys) { updateStmt.run(pubkey); eventStmt.run(pubkey, JSON.stringify({ signature, batchTotal: lamports })); }`
                // If 'lamports' passed to recordSuccess is the BATCH total, then we might be overcounting if we sum it up for every account in the batch.
                // ReclaimerOrchestrator: 
                // `const result = await this.executor.executeBatch(batch);`
                // `result.lamportsRecovered` is batch total.
                // `this.reporter.recordSuccess(pubkeys, ..., result.lamportsRecovered);`
                // Yes, unfortunately the current reporter implementation stamps the BATCH total onto EACH individual account event.
                // This means if I sum them up blindly, I will duplicate the amount N times for a batch of N.
                // BUT, I can deduplicate by Signature!
                if (evidence.batchTotal) {
                    // We handle this below by grouping by signature
                }
            }
            catch (e) {
                // ignore malformed
            }
        }
        // Let's re-query distinct signatures to sum properly if possible.
        // Or if we can find individual amounts. 
        // Actually, `evidence_payload` on `RECLAIMED` is our source.
        // We need to fetch all, parse, group by signature, take one instance of batchTotal?
        const uniqueTx = new Set();
        let trueTotalLamports = 0;
        for (const event of reclaimEvents) {
            try {
                const ev = JSON.parse(event.evidence_payload);
                if (ev.signature && ev.batchTotal) {
                    if (!uniqueTx.has(ev.signature)) {
                        trueTotalLamports += ev.batchTotal;
                        uniqueTx.add(ev.signature);
                    }
                }
                else if (ev.amount) {
                    // Legacy or single account mode
                    trueTotalLamports += ev.amount;
                }
            }
            catch (e) { }
        }
        // 4. Failed actions
        const failedCount = this.db.prepare(`SELECT COUNT(*) as count FROM lifecycle_events WHERE new_state = 'FAILED'`).pluck().get();
        // 5. Execution Duration
        // Min discovered_at vs Max timestamp in events
        const firstDiscovery = this.db.prepare(`SELECT MIN(discovered_at) FROM sponsored_accounts`).pluck().get();
        const lastEvent = this.db.prepare(`SELECT MAX(timestamp) FROM lifecycle_events`).pluck().get();
        let duration = 0;
        if (firstDiscovery && lastEvent) {
            const start = new Date(firstDiscovery).getTime();
            const end = new Date(lastEvent).getTime();
            duration = (end - start) / 1000;
        }
        // Calculate Average Batch Size
        const txCounts = new Map();
        for (const event of reclaimEvents) {
            try {
                const ev = JSON.parse(event.evidence_payload);
                if (ev.signature) {
                    txCounts.set(ev.signature, (txCounts.get(ev.signature) || 0) + 1);
                }
            }
            catch (e) { }
        }
        let totalBatchSize = 0;
        let batchCount = 0;
        for (const count of txCounts.values()) {
            totalBatchSize += count;
            batchCount++;
        }
        const avgBatchSize = batchCount > 0 ? totalBatchSize / batchCount : 0;
        return {
            total_discovered: totalDiscovered,
            total_evaluated: totalEvaluated,
            state_counts: stateCounts,
            total_reclaimed_lamports: trueTotalLamports,
            total_failed_reclamations: failedCount,
            average_batch_size: parseFloat(avgBatchSize.toFixed(2)),
            execution_duration_sec: duration
        };
    }
}
exports.MetricsAggregator = MetricsAggregator;
