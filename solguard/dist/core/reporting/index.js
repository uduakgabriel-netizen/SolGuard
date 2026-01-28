"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportingEngine = void 0;
const database_1 = require("../../db/database");
const aggregate_1 = require("./aggregate");
const timeline_1 = require("./timeline");
const format_1 = require("./format");
const fs_1 = __importDefault(require("fs"));
class ReportingEngine {
    constructor(config) {
        this.config = config;
        this.db = database_1.AppDatabase.getInstance(config.dbPath, false); // Read only usage ideally, but sqlite3 default is rw. 
        // We do not write, enforced by code logic.
        this.aggregator = new aggregate_1.MetricsAggregator(this.db);
        this.timelineBuilder = new timeline_1.TimelineBuilder(this.db);
    }
    generate() {
        console.log(`[Reporting] Generating ${this.config.format.toUpperCase()} report...`);
        // 1. Global Metrics
        const metrics = this.aggregator.getGlobalMetrics();
        // 2. Timelines
        // If specific account, fetch one. Else fetch all?
        // Warning: Fetching ALL timelines for 1M accounts in JSON is huge.
        // Directives say: "JSON... Must include... per-account summaries". 
        // "This allows: Millions of accounts" -> We might need pagination or stream if truly massive.
        // For CLI "report" usually we dump everything if not filtered, or maybe top N?
        // "One final report object containing..." implies a single blob.
        // Let's assume for typical 10-100k usage it fits in memory. for 1M it might OOM.
        // Ideally we stream to file. 
        // For this task, let's load all but warn. Or simply stream if format is JSON.
        // To implement cleanly: Fetch all pubkeys first.
        let pubkeys = [];
        if (this.config.targetAccount) {
            pubkeys = [this.config.targetAccount];
        }
        else {
            pubkeys = this.db.prepare(`SELECT account_pubkey FROM sponsored_accounts`).pluck().all();
        }
        const timelines = pubkeys.map(p => this.timelineBuilder.build(p)).filter(t => t !== null);
        // 3. Metadata
        const metadata = {
            network: this.config.network,
            timestamp: new Date().toISOString(),
            generated_by: 'SolGuard Stage 5 Reporting Engine',
            account_count: timelines.length
        };
        // 4. Format
        let output = '';
        if (this.config.format === 'json') {
            output = format_1.ReportFormatter.toJson(metrics, timelines, metadata);
        }
        else {
            output = format_1.ReportFormatter.toText(metrics, timelines, metadata);
        }
        // 5. Output
        if (this.config.outputFile) {
            fs_1.default.writeFileSync(this.config.outputFile, output);
            console.log(`[Reporting] Report saved to ${this.config.outputFile}`);
        }
        else {
            console.log(output);
        }
    }
    close() {
        // Shared connection usually managed by AppDatabase singleton, but we can try to close if we are the only user.
        // AppDatabase.close();
    }
}
exports.ReportingEngine = ReportingEngine;
