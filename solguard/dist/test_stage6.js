"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = require("./db/database");
const service_1 = require("./core/attestation/service");
const attestor_1 = require("./core/attestation/attestor");
const web3_js_1 = require("@solana/web3.js");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
async function runTest() {
    const dbPath = path_1.default.join(process.cwd(), 'test_attestation_rerun.db');
    if (fs_1.default.existsSync(dbPath))
        fs_1.default.unlinkSync(dbPath);
    const db = database_1.AppDatabase.getInstance(dbPath);
    console.log('--- Seeding Database ---');
    // Populate sponsored_accounts
    const insertAccount = db.prepare(`
        INSERT INTO sponsored_accounts 
        (account_pubkey, creation_signature, slot, operator_pubkey, lifecycle_state, lamports)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertEvent = db.prepare(`
        INSERT INTO lifecycle_events
        (account_pubkey, old_state, new_state, trigger_reason, evidence_payload)
        VALUES (?, ?, ?, ?, ?)
    `);
    // 1. Account A: Active (No events relevant to result details)
    insertAccount.run('PubkeyA_Active', 'sig1', 100, 'Operator1', 'ACTIVE', 5000000);
    // 2. Account B: Reclaimed
    insertAccount.run('PubkeyB_Reclaimed', 'sig2', 101, 'Operator1', 'RECLAIMED', 0);
    // Add event for reclamation
    insertEvent.run('PubkeyB_Reclaimed', 'RECLAIMABLE', 'RECLAIMED', 'Reclamation Success', JSON.stringify({ amount: 2000000, signature: 'tx_sig_reclaim_B' }));
    // 3. Account C: Failed
    insertAccount.run('PubkeyC_Failed', 'sig3', 102, 'Operator1', 'FAILED', 1000);
    insertEvent.run('PubkeyC_Failed', 'RECLAIMABLE', 'FAILED', 'Transaction simulation failed', null);
    console.log('--- Database Seeded ---');
    const service = new service_1.AttestationService(db, 'devnet');
    const operatorKeypair = web3_js_1.Keypair.generate();
    // Test 1: Generate without signature
    console.log('\n--- Test 1: Unsigned Attestation ---');
    const config = { min_lamports: 1000 };
    const doc1 = service.generate(config, undefined);
    console.log('Generated Doc 1 Hash:', doc1.attestation_hash);
    if (attestor_1.Attestor.verify(doc1)) {
        console.log('✅ Doc 1 Verification PASSED');
    }
    else {
        console.error('❌ Doc 1 Verification FAILED');
        process.exit(1);
    }
    // Test 2: Generate with signature
    console.log('\n--- Test 2: Signed Attestation ---');
    const doc2 = service.generate(config, operatorKeypair);
    console.log('Generated Doc 2 Hash:', doc2.attestation_hash);
    console.log('Signature:', doc2.signature);
    if (attestor_1.Attestor.verify(doc2)) {
        console.log('✅ Doc 2 Verification PASSED');
    }
    else {
        console.error('❌ Doc 2 Verification FAILED');
        process.exit(1);
    }
    // Test 3: Determinism (Repeat Test 2)
    console.log('\n--- Test 3: Determinism Check ---');
    const doc3 = service.generate(config, operatorKeypair);
    if (doc2.attestation_hash === doc3.attestation_hash) {
        console.log('✅ Hash Determinism: MATCH');
    }
    else {
        console.error('❌ Hash Determinism: MISMATCH');
        console.error('Doc2:', doc2.attestation_hash);
        console.error('Doc3:', doc3.attestation_hash);
        process.exit(1);
    }
    if (doc2.signature === doc3.signature) {
        console.log('✅ Signature Determinism: MATCH');
    }
    else {
        console.error('❌ Signature Determinism: MISMATCH');
    }
    // Verify content of Result Digest
    console.log('\n--- Content Verification ---');
    if (doc2.result_digest.total_lamports_reclaimed === "2000000") {
        console.log('✅ Total Lamports Reclaimed Correct (2000000)');
    }
    else {
        console.error('❌ Total Lamports Incorrect:', doc2.result_digest.total_lamports_reclaimed);
    }
    if (doc2.result_digest.failures.find(f => f.pubkey === 'PubkeyC_Failed')) {
        console.log('✅ Failure Recorded Correctly');
    }
    else {
        console.error('❌ Failure Missing');
    }
    console.log('\nALL TESTS PASSED');
    db.close();
    fs_1.default.unlinkSync(dbPath);
}
runTest().catch(e => {
    console.error(e);
    process.exit(1);
});
