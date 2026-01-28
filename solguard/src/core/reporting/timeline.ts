import Database from 'better-sqlite3';

export interface TimelineEvent {
    timestamp: string;
    from_state?: string;
    to_state: string;
    reason: string;
    metadata: any;
}

export interface AccountTimeline {
    pubkey: string;
    current_state: string;
    events: TimelineEvent[];
}

export class TimelineBuilder {
    private readonly db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
    }

    public build(pubkey: string): AccountTimeline | null {
        // 1. Get current state
        const account = this.db.prepare(
            `SELECT lifecycle_state FROM sponsored_accounts WHERE account_pubkey = ?`
        ).get(pubkey) as { lifecycle_state: string };

        if (!account) return null;

        // 2. Get history
        const rows = this.db.prepare(
            `SELECT * FROM lifecycle_events WHERE account_pubkey = ? ORDER BY timestamp ASC`
        ).all(pubkey) as any[];

        const events: TimelineEvent[] = rows.map(r => {
            let meta = {};
            try {
                meta = JSON.parse(r.evidence_payload || '{}');
            } catch (e) { }

            return {
                timestamp: r.timestamp,
                from_state: r.old_state,
                to_state: r.new_state,
                reason: r.trigger_reason,
                metadata: meta
            };
        });

        // Implicit: Add 'DISCOVERED' as the genesis event using discovered_at if we want?
        // The requirements say "DISCOVERED -> POLICY...". 
        // Usually indexer doesn't write an event to 'lifecycle_events' table on creation, only to 'sponsored_accounts'.
        // So we should synthesize the start event.

        const genesis = this.db.prepare(
            `SELECT discovered_at, creation_signature, slot FROM sponsored_accounts WHERE account_pubkey = ?`
        ).get(pubkey) as any;

        if (genesis) {
            events.unshift({
                timestamp: genesis.discovered_at,
                from_state: 'UNKNOWN',
                to_state: 'DISCOVERED',
                reason: 'Indexer Discovery',
                metadata: {
                    signature: genesis.creation_signature,
                    slot: genesis.slot
                }
            });
        }

        return {
            pubkey,
            current_state: account.lifecycle_state,
            events
        };
    }
}
