import Database from 'better-sqlite3';
import { Keypair } from '@solana/web3.js';
import fs from 'fs';
import { ManifestBuilder, ExecutionManifest } from './manifest';
import { StateHasher } from './state_hash';
import { ResultBuilder, ExecutionResultDigest } from './result';
import { Attestor, AttestationDoc } from './attestor';

interface SponsoredAccountRow {
    account_pubkey: string;
    lifecycle_state: string;
    lamports: number;
}

interface LifecycleEventRow {
    evidence_payload: string | null;
    trigger_reason: string;
}


export class AttestationService {
    constructor(private db: Database.Database, private network: string) { }

    public generate(
        config: any,
        operatorKeypair?: Keypair,
        rpcEndpoint: string = 'unknown'
    ): AttestationDoc {
        // 1. Compute DB State Hash
        const stateHasher = new StateHasher(this.db);
        const dbHash = stateHasher.computeStateHash();

        // 2. Build Result Digest (scan DB for what happened)
        const resultBuilder = new ResultBuilder();

        // Scan accounts
        const accounts = this.db.prepare('SELECT account_pubkey, lifecycle_state, lamports FROM sponsored_accounts').all() as SponsoredAccountRow[];
        const candidateKeys: string[] = [];

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
            `).get(row.account_pubkey) as LifecycleEventRow | undefined;

            if (event && event.evidence_payload) {
                try {
                    const payload = JSON.parse(event.evidence_payload);
                    if (payload.amount) reclaimedAmt = payload.amount;
                    if (payload.signature) resultBuilder.addSignature(payload.signature);
                } catch (e) { }
            }

            resultBuilder.addResult(row.account_pubkey, row.lifecycle_state, reclaimedAmt);

            // Check for failures (e.g. state failed)
            if (row.lifecycle_state === 'FAILED') {
                const failEvent = this.db.prepare(`
                    SELECT trigger_reason FROM lifecycle_events 
                    WHERE account_pubkey = ? AND new_state = 'FAILED'
                `).get(row.account_pubkey) as LifecycleEventRow | undefined;
                resultBuilder.addFailure(row.account_pubkey, failEvent?.trigger_reason || 'Unknown error');
            }
        }

        const resultDigest = resultBuilder.build();

        // 3. Build Manifest
        const manifestBuilder = new ManifestBuilder(
            this.network,
            config,
            operatorKeypair ? operatorKeypair.publicKey.toBase58() : null,
            rpcEndpoint,
            dbHash
        );
        manifestBuilder.addCandidates(candidateKeys);
        const manifest = manifestBuilder.build();

        // 4. Attest
        return Attestor.generate(manifest, resultDigest, operatorKeypair);
    }
}
