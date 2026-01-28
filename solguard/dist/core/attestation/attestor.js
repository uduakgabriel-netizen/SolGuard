"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Attestor = void 0;
const crypto_1 = __importDefault(require("crypto"));
const manifest_1 = require("./manifest");
const result_1 = require("./result");
const tweetnacl_1 = __importDefault(require("tweetnacl"));
const bs58_1 = __importDefault(require("bs58"));
class Attestor {
    /**
     * Generates the final attestation document.
     * @param manifest The canonical execution manifest
     * @param resultDigest The execution result summary
     * @param operatorKeypair Optional keypair to sign the attestation
     */
    static generate(manifest, resultDigest, operatorKeypair) {
        // 1. Serialize components canonically
        const manifestStr = (0, manifest_1.stringifyManifest)(manifest);
        // Note: db_state_hash is already inside manifest, but the prompt says compute hash of:
        // ATT_HASH = SHA256(Manifest + DatabaseStateHash + ExecutionResultDigest)
        // Check if DB Hash is redundant if it's in Manifest.
        // Prompt says: "Manifest ... containing ... Database state hash".
        // Then says: "ATT_HASH = SHA256(ExecutionManifest + DatabaseStateHash + ExecutionResultDigest)"
        // This implies DatabaseStateHash might be treated as a separate block or emphatic. 
        // We will include it as requested, even if redundant.
        const dbHash = manifest.db_state_hash;
        const resultStr = (0, result_1.stringifyResult)(resultDigest);
        // 2. Compute Attestation Hash
        const hasher = crypto_1.default.createHash('sha256');
        hasher.update(manifestStr);
        hasher.update(dbHash);
        hasher.update(resultStr);
        const attestationHashBytes = hasher.digest();
        const attestationHashHex = attestationHashBytes.toString('hex');
        // 3. Sign if keypair provided
        let signature;
        if (operatorKeypair) {
            // Sign the raw 32-byte hash, not the hex string, for standard ed25519 usage?
            // Usually, standard is creating a detached signature of the message. 
            // The message here is effectively the concatenated inputs.
            // Signing the HASH is valid (blind signing), commonly used in some protocols.
            // We will sign the HASH bytes.
            const sig = tweetnacl_1.default.sign.detached(attestationHashBytes, operatorKeypair.secretKey);
            signature = Buffer.from(sig).toString('base64');
        }
        return {
            manifest,
            db_state_hash: dbHash,
            result_digest: resultDigest,
            attestation_hash: attestationHashHex,
            signature
        };
    }
    /**
     * Verifies an attestation document.
     * @param doc The attestation document JSON
     * @returns boolean True if valid
     */
    static verify(doc) {
        // 1. Recompute Hash
        const manifestStr = (0, manifest_1.stringifyManifest)(doc.manifest);
        const dbHash = doc.db_state_hash;
        const resultStr = (0, result_1.stringifyResult)(doc.result_digest);
        const hasher = crypto_1.default.createHash('sha256');
        hasher.update(manifestStr);
        hasher.update(dbHash);
        hasher.update(resultStr);
        const computedHashBytes = hasher.digest();
        const computedHashHex = computedHashBytes.toString('hex');
        if (computedHashHex !== doc.attestation_hash) {
            console.error(`[Attestation] Hash Mismatch!`);
            console.error(`Expected: ${computedHashHex}`);
            console.error(`Actual:   ${doc.attestation_hash}`);
            return false;
        }
        // 2. Verify DB Hash consistency
        if (doc.manifest.db_state_hash && doc.manifest.db_state_hash !== doc.db_state_hash) {
            console.error(`[Attestation] Manifest DB Hash does not match top-level DB Hash`);
            return false;
        }
        // 3. Verify Signature if present
        if (doc.signature && doc.manifest.operator_pubkey) {
            try {
                const pubkeyBytes = bs58_1.default.decode(doc.manifest.operator_pubkey);
                const sigBytes = new Uint8Array(Buffer.from(doc.signature, 'base64'));
                const isValid = tweetnacl_1.default.sign.detached.verify(computedHashBytes, sigBytes, pubkeyBytes);
                if (!isValid) {
                    console.error(`[Attestation] Invalid Signature!`);
                    return false;
                }
            }
            catch (e) {
                console.error(`[Attestation] Signature verification error:`, e);
                return false;
            }
        }
        return true;
    }
}
exports.Attestor = Attestor;
