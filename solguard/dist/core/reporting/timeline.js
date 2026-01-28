"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimelineBuilder = void 0;
class TimelineBuilder {
    constructor(db) {
        this.db = db;
    }
    build(pubkey) {
        // 1. Get current state
        const account = this.db.prepare(`SELECT lifecycle_state FROM sponsored_accounts WHERE account_pubkey = ?`).get(pubkey);
        if (!account)
            return null;
        // 2. Get history
        const rows = this.db.prepare(`SELECT * FROM lifecycle_events WHERE account_pubkey = ? ORDER BY timestamp ASC`).all(pubkey);
        const events = rows.map(r => {
            let meta = {};
            try {
                meta = JSON.parse(r.evidence_payload || '{}');
            }
            catch (e) { }
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
        const genesis = this.db.prepare(`SELECT discovered_at, creation_signature, slot FROM sponsored_accounts WHERE account_pubkey = ?`).get(pubkey);
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
exports.TimelineBuilder = TimelineBuilder;
