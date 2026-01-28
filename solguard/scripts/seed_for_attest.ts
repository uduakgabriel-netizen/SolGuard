import { AppDatabase } from '../src/db/database';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'kora-rent-devnet.db');

// Delete existing DB to start fresh
if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
}

const db = AppDatabase.getInstance(DB_PATH, true);

console.log('Seeding DB for Attestation Test...');

// 1. Insert Sponsored Account
const pubkey = 'TestAccount111111111111111111111111111111111';
db.prepare(`
    INSERT INTO sponsored_accounts 
    (account_pubkey, creation_signature, slot, operator_pubkey, lifecycle_state, lamports, data_len, owner_program)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(
    pubkey,
    'sig12345',
    100,
    'OperatorKey1111111111111111111111111111111111',
    'RECLAIMED',
    0, // Current balance
    0,
    'SystemProgram'
);

// 2. Insert Events
// Discovery
db.prepare(`
    INSERT INTO lifecycle_events (account_pubkey, old_state, new_state, trigger_reason, timestamp)
    VALUES (?, ?, ?, ?, ?)
`).run(pubkey, 'DISCOVERED', 'ACTIVE', 'Initial Scan', '2023-01-01T00:00:00Z');

// Reclamation
db.prepare(`
    INSERT INTO lifecycle_events (account_pubkey, old_state, new_state, trigger_reason, evidence_payload, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
`).run(
    pubkey,
    'RECLAIMABLE',
    'RECLAIMED',
    'Policy Check',
    JSON.stringify({ amount: 890880, signature: 'reclaim_tx_signature_abc' }),
    '2023-01-02T00:00:00Z'
);

console.log('Seeding Complete.');
