import { Keypair } from '@solana/web3.js';
import crypto from 'crypto';
import { ExecutionManifest, stringifyManifest } from './manifest';
import { ExecutionResultDigest, stringifyResult } from './result';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

export interface AttestationDoc {
    manifest: ExecutionManifest;
    db_state_hash: string;
    result_digest: ExecutionResultDigest;
    attestation_hash: string;
    signature?: string; // Base64 signature of attestation_hash
}

export class Attestor {
    /**
     * Generates the final attestation document.
     * @param manifest The canonical execution manifest
     * @param resultDigest The execution result summary
     * @param operatorKeypair Optional keypair to sign the attestation
     */
    static generate(
        manifest: ExecutionManifest,
        resultDigest: ExecutionResultDigest,
        operatorKeypair?: Keypair
    ): AttestationDoc {
        // 1. Serialize components canonically
        const manifestStr = stringifyManifest(manifest);
        // Note: db_state_hash is already inside manifest, but the prompt says compute hash of:
        // ATT_HASH = SHA256(Manifest + DatabaseStateHash + ExecutionResultDigest)
        // Check if DB Hash is redundant if it's in Manifest.
        // Prompt says: "Manifest ... containing ... Database state hash".
        // Then says: "ATT_HASH = SHA256(ExecutionManifest + DatabaseStateHash + ExecutionResultDigest)"
        // This implies DatabaseStateHash might be treated as a separate block or emphatic. 
        // We will include it as requested, even if redundant.

        const dbHash = manifest.db_state_hash;
        const resultStr = stringifyResult(resultDigest);

        // 2. Compute Attestation Hash
        const hasher = crypto.createHash('sha256');
        hasher.update(manifestStr);
        hasher.update(dbHash);
        hasher.update(resultStr);

        const attestationHashBytes = hasher.digest();
        const attestationHashHex = attestationHashBytes.toString('hex');

        // 3. Sign if keypair provided
        let signature: string | undefined;
        if (operatorKeypair) {
            // Sign the raw 32-byte hash, not the hex string, for standard ed25519 usage?
            // Usually, standard is creating a detached signature of the message. 
            // The message here is effectively the concatenated inputs.
            // Signing the HASH is valid (blind signing), commonly used in some protocols.
            // We will sign the HASH bytes.
            const sig = nacl.sign.detached(attestationHashBytes, operatorKeypair.secretKey);
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
    static verify(doc: AttestationDoc): boolean {
        // 1. Recompute Hash
        const manifestStr = stringifyManifest(doc.manifest);
        const dbHash = doc.db_state_hash;
        const resultStr = stringifyResult(doc.result_digest);

        const hasher = crypto.createHash('sha256');
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
                const pubkeyBytes = bs58.decode(doc.manifest.operator_pubkey);
                const sigBytes = new Uint8Array(Buffer.from(doc.signature, 'base64'));

                const isValid = nacl.sign.detached.verify(
                    computedHashBytes,
                    sigBytes,
                    pubkeyBytes
                );

                if (!isValid) {
                    console.error(`[Attestation] Invalid Signature!`);
                    return false;
                }
            } catch (e) {
                console.error(`[Attestation] Signature verification error:`, e);
                return false;
            }
        }

        return true;
    }
}
