"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AttestationService = void 0;
const manifest_1 = require("./manifest");
const state_hash_1 = require("./state_hash");
const result_1 = require("./result");
const attestor_1 = require("./attestor");
class AttestationService {
    constructor(db, network) {
        this.db = db;
        this.network = network;
    }
    generate(config, operatorKeypair, rpcEndpoint = 'unknown') {
        // 1. Compute DB State Hash
        const stateHasher = new state_hash_1.StateHasher(this.db);
        const dbHash = stateHasher.computeStateHash();
        // 2. Build Result Digest (scan DB for what happened)
        const resultBuilder = new result_1.ResultBuilder();
        // Scan accounts
        const accounts = this.db.prepare('SELECT account_pubkey, lifecycle_state, lamports FROM sponsored_accounts').all();
        const candidateKeys = [];
        for (const row of accounts) {
            candidateKeys.push(row.account_pubkey);
            // If RECLAIMED, we assume the lamports were reclaimed.
            // Note: In a real run, we'd have exact amounts in events. 
            // Here we use current balance if reclaimed (which should be 0?) 
            // or the last known balance. 
            // The prompt asks for "Total lamports reclaimed".
            // If state is RECLAIMED, allow adding it.
            let reclaimedAmt = 0;
            if (row.lifecycle_state === 'RECLAIMED') {
                // In Stage 4, we likely cleared lamports or have a record.
                // We will try to find the reclamation event to get exact amount if possible.
                // For now, use row.lamports if it reflects the amount *before* reclaim? 
                // Or if it is 0 now.
                // Ideally we look at lifecycle_events.
                reclaimedAmt = 0; // Placeholder if we can't find it easily without complex logic
            }
            // To be precise, let's look for "RECLAIMED" event for this account
            const event = this.db.prepare(`
                SELECT evidence_payload FROM lifecycle_events 
                WHERE account_pubkey = ? AND new_state = 'RECLAIMED'
            `).get(row.account_pubkey);
            if (event && event.evidence_payload) {
                try {
                    const payload = JSON.parse(event.evidence_payload);
                    if (payload.amount)
                        reclaimedAmt = payload.amount;
                    if (payload.signature)
                        resultBuilder.addSignature(payload.signature);
                }
                catch (e) { }
            }
            resultBuilder.addResult(row.account_pubkey, row.lifecycle_state, reclaimedAmt);
            // Check for failures (e.g. state failed)
            if (row.lifecycle_state === 'FAILED') {
                const failEvent = this.db.prepare(`
                    SELECT trigger_reason FROM lifecycle_events 
                    WHERE account_pubkey = ? AND new_state = 'FAILED'
                `).get(row.account_pubkey);
                resultBuilder.addFailure(row.account_pubkey, failEvent?.trigger_reason || 'Unknown error');
            }
        }
        const resultDigest = resultBuilder.build();
        // 3. Build Manifest
        const manifestBuilder = new manifest_1.ManifestBuilder(this.network, config, operatorKeypair ? operatorKeypair.publicKey.toBase58() : null, rpcEndpoint, dbHash);
        manifestBuilder.addCandidates(candidateKeys);
        const manifest = manifestBuilder.build();
        // 4. Attest
        return attestor_1.Attestor.generate(manifest, resultDigest, operatorKeypair);
    }
}
exports.AttestationService = AttestationService;
