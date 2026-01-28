"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ManifestBuilder = void 0;
exports.stringifyManifest = stringifyManifest;
const utils_1 = require("./utils");
class ManifestBuilder {
    constructor(network, config, operatorPubkey, rpcEndpoint, dbStateHash) {
        this.network = network;
        this.config = config;
        this.operatorPubkey = operatorPubkey;
        this.rpcEndpoint = rpcEndpoint;
        this.dbStateHash = dbStateHash;
        this.candidates = [];
    }
    /**
     * Adds candidate accounts to the manifest.
     * Ensures they are sorted later.
     */
    addCandidates(pubkeys) {
        this.candidates.push(...pubkeys);
    }
    /**
     * Builds the canonical execution manifest.
     * Enforces deterministic sorting and structure.
     */
    build() {
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
    sanitizeRpc(url) {
        try {
            const u = new URL(url);
            return `${u.protocol}//${u.host}`;
        }
        catch {
            return 'unknown-rpc';
        }
    }
}
exports.ManifestBuilder = ManifestBuilder;
/**
 * Canonically stringifies the manifest for hashing.
 */
function stringifyManifest(manifest) {
    return JSON.stringify((0, utils_1.canonicalize)(manifest));
}
