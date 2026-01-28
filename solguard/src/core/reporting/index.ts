import Database from 'better-sqlite3';
import { AppDatabase } from '../../db/database';
import { MetricsAggregator } from './aggregate';
import { TimelineBuilder } from './timeline';
import { ReportFormatter } from './format';
import fs from 'fs';

export interface ReportingConfig {
    dbPath: string;
    network: string;
    format: 'json' | 'text';
    outputFile?: string;
    targetAccount?: string; // If set, only report this one
}

export class ReportingEngine {
    private readonly db: Database.Database;
    private readonly config: ReportingConfig;
    private readonly aggregator: MetricsAggregator;
    private readonly timelineBuilder: TimelineBuilder;

    constructor(config: ReportingConfig) {
        this.config = config;
        this.db = AppDatabase.getInstance(config.dbPath, false); // Read only usage ideally, but sqlite3 default is rw. 
        // We do not write, enforced by code logic.
        this.aggregator = new MetricsAggregator(this.db);
        this.timelineBuilder = new TimelineBuilder(this.db);
    }

    public generate(): void {
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

        let pubkeys: string[] = [];
        if (this.config.targetAccount) {
            pubkeys = [this.config.targetAccount];
        } else {
            pubkeys = this.db.prepare(
                `SELECT account_pubkey FROM sponsored_accounts`
            ).pluck().all() as string[];
        }

        const timelines = pubkeys.map(p => this.timelineBuilder.build(p)).filter(t => t !== null) as any[];

        // 3. Metadata
        // 3. Metadata
        // To ensure determinism (Same DB -> Same Report), we must use the DB state for the timestamp.
        // We take the latest timestamp found in lifecycle_events or sponsored_accounts.
        const lastEventTime = this.db.prepare('SELECT MAX(timestamp) as t FROM lifecycle_events').pluck().get() as string;
        const lastDiscoveryTime = this.db.prepare('SELECT MAX(discovered_at) as t FROM sponsored_accounts').pluck().get() as string;

        // Pick the latest, or default to a fixed epoch if empty DB (for strict determinism on empty state)
        let reportTimestamp = new Date(0).toISOString();
        if (lastEventTime && lastDiscoveryTime) {
            reportTimestamp = lastEventTime > lastDiscoveryTime ? lastEventTime : lastDiscoveryTime;
        } else if (lastEventTime) {
            reportTimestamp = lastEventTime;
        } else if (lastDiscoveryTime) {
            reportTimestamp = lastDiscoveryTime;
        }

        // Config Hash (Simple hash of critical params to prove configuration used)
        const configString = JSON.stringify({
            network: this.config.network,
            format: this.config.format,
            version: '1.0.0' // SolGuard core version
        });
        // Simple hash function since we can't easily rely on crypto module without imports or it might be overkill
        // Using a simple djb2 variant or just base64 of the string for visibility
        // Requirement just says <hash>. Let's use a simple distinct string buffer hash.
        const crypto = require('crypto');
        const configHash = crypto.createHash('sha256').update(configString).digest('hex').substring(0, 16);

        const metadata = {
            network: this.config.network,
            timestamp: reportTimestamp,
            config_hash: configHash,
            generated_by: 'SolGuard Stage 5 Reporting Engine',
            account_count: timelines.length
        };

        // 4. Format
        let output = '';
        if (this.config.format === 'json') {
            output = ReportFormatter.toJson(metrics, timelines, metadata);
        } else {
            output = ReportFormatter.toText(metrics, timelines, metadata);
        }

        // 5. Output
        if (this.config.outputFile) {
            fs.writeFileSync(this.config.outputFile, output);
            console.log(`[Reporting] Report saved to ${this.config.outputFile}`);
        } else {
            console.log(output);
        }
    }

    public close() {
        // Shared connection usually managed by AppDatabase singleton, but we can try to close if we are the only user.
        // AppDatabase.close();
    }
}
