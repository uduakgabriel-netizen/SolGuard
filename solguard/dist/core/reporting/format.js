"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportFormatter = void 0;
class ReportFormatter {
    static toJson(metrics, timelines, metadata) {
        return JSON.stringify({
            metadata,
            global_metrics: metrics,
            accounts: timelines
        }, null, 2);
    }
    static toText(metrics, timelines, metadata) {
        const header = `
SolGuard Execution Report
-------------------------
Network:     ${metadata.network}
Timestamp:   ${metadata.timestamp}
Duration:    ${metrics.execution_duration_sec.toFixed(2)}s

GLOBAL METRICS
--------------
Total Discovered:   ${metrics.total_discovered}
Total Evaluated:    ${metrics.total_evaluated}
Recovered:          ${(metrics.total_reclaimed_lamports / 1000000000).toFixed(9)} SOL
Failed Reclaims:    ${metrics.total_failed_reclamations}

STATE BREAKDOWN
---------------
${Object.entries(metrics.state_counts).map(([k, v]) => `- ${k.padEnd(15)}: ${v}`).join('\n')}
`;
        const detailed = timelines.map(t => this.formatTimeline(t)).join('\n');
        return `${header}\n\nACCOUNT TIMELINES (${timelines.length} shown)\n-------------------\n${detailed}`;
    }
    static formatTimeline(t) {
        const events = t.events.map(e => {
            const time = new Date(e.timestamp).toISOString().split('T')[1].replace('Z', ''); // Simple time
            return `  [${time}] ${e.from_state} -> ${e.to_state} | ${e.reason}`;
        }).join('\n');
        return `
Account: ${t.pubkey}
Current: ${t.current_state}
History:
${events}
`;
    }
}
exports.ReportFormatter = ReportFormatter;
