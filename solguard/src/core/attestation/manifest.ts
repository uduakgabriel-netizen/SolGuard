import { PublicKey } from '@solana/web3.js';
import crypto from 'crypto';
import { canonicalize } from './utils';

export interface ExecutionManifest {
    version: string;
    network: string;
    operator_pubkey: string | null;
    config: {
        min_lamports: number;
        min_age_days: number;
        whitelist_hash: string | null;
        [key: string]: any;
    };
    rpc_endpoint: string;
    db_state_hash: string;
    candidates: string[]; // Sorted list of pubkeys
}

export class ManifestBuilder {
    private candidates: string[] = [];

    constructor(
        private network: string,
        private config: any,
        private operatorPubkey: string | null,
        private rpcEndpoint: string,
        private dbStateHash: string
    ) { }

    /**
     * Adds candidate accounts to the manifest.
     * Ensures they are sorted later.
     */
    addCandidates(pubkeys: string[]) {
        this.candidates.push(...pubkeys);
    }

    /**
     * Builds the canonical execution manifest.
     * Enforces deterministic sorting and structure.
     */
    build(): ExecutionManifest {
        // Enforce sorted candidates (unique)
        const sortedCandidates = Array.from(new Set(this.candidates)).sort();

        // Sanitize RPC endpoint to avoid leaking secrets (just hostname or known identifier)
        const sanitizedRpc = this.sanitizeRpc(this.rpcEndpoint);

        return {
            version: '1.0.0', // SolGuard Version
            network: this.network,
            operator_pubkey: this.operatorPubkey,
            config: {
                min_lamports: this.config.MIN_LAMPORTS_RECLAIM || 0,
                min_age_days: this.config.MIN_AGE_DAYS || 0,
                whitelist_hash: this.config.whitelist_hash || null,
            },
            rpc_endpoint: sanitizedRpc,
            db_state_hash: this.dbStateHash,
            candidates: sortedCandidates
        };
    }

    private sanitizeRpc(url: string): string {
        try {
            const u = new URL(url);
            return `${u.protocol}//${u.host}`;
        } catch {
            return 'unknown-rpc';
        }
    }
}

/**
 * Canonically stringifies the manifest for hashing.
 */
export function stringifyManifest(manifest: ExecutionManifest): string {
    return JSON.stringify(canonicalize(manifest));
}
