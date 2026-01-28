// src/core/indexer.ts
import { Connection, PublicKey, ParsedTransactionWithMeta, SystemProgram } from '@solana/web3.js';
import Database from 'better-sqlite3';
import { AppDatabase, LogLevel } from '../db/database';
import { AnyInstruction, isParsedInstruction } from '../solana/utils';

// --- Constants for tuning and configuration ---
const SIGNATURE_CURSOR_KEY = 'discovery_cursor_last_signature';
const SIGNATURE_FETCH_LIMIT = 100; // Number of signatures to fetch from the RPC at a time.
const TRANSACTION_FETCH_DELAY_MS = 200; // Polite delay between individual transaction fetches.

// A simple sleep utility
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export interface IndexerConfig {
  operator: PublicKey;
  rpcUrl: string;
  dbPath: string;
  dryRun: boolean;
}

/**
 * The core Indexer class responsible for discovering sponsored accounts.
 */
export class Indexer {
  private readonly connection: Connection;
  private readonly db: Database.Database;
  private readonly config: IndexerConfig;

  constructor(config: IndexerConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.db = AppDatabase.getInstance(config.dbPath, false);
  }
  
  /**
   * Logs a message to both the console and the audit_log table.
   */
  private log(level: LogLevel, message: string, metadata?: object) {
    console.log(`[${level}] ${message}`, metadata || '');
    if (!this.config.dryRun) {
        AppDatabase.log(this.db, level, message, metadata);
    }
  }

  /**
   * Main entry point to run the discovery engine.
   */
  public async run(): Promise<void> {
    this.log('INFO', 'Starting indexer run.', this.config);
    
    const untilSignature = this.getCursor();
    let beforeSignature: string | undefined = undefined;
    let totalSignaturesScanned = 0;
    let totalAccountsDiscovered = 0;
    
    let hasMore = true;
    while (hasMore) {
      try {
        const signatures = await this.connection.getSignaturesForAddress(this.config.operator, {
          limit: SIGNATURE_FETCH_LIMIT,
          until: untilSignature,
          before: beforeSignature,
        });

        if (signatures.length === 0) {
          hasMore = false;
          continue;
        }

        const latestInBatch = signatures[0].signature;
        const oldestInBatch = signatures[signatures.length - 1].signature;
        beforeSignature = oldestInBatch;
        totalSignaturesScanned += signatures.length;

        this.log('INFO', `Processing ${signatures.length} signatures.`, { from: latestInBatch, to: oldestInBatch });

        for (const sigInfo of signatures) {
            const tx = await this.connection.getParsedTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0 });
            if (tx) {
                const discovered = this.parseTransaction(tx);
                if (discovered) totalAccountsDiscovered++;
            }
            // Polite delay to avoid hammering the RPC endpoint.
            await sleep(TRANSACTION_FETCH_DELAY_MS);
        }

        // Only update the cursor with the latest signature from the first batch of a new run.
        // This ensures that if the process crashes, it will re-scan the partial batch.
        if (!untilSignature) {
            this.saveCursor(latestInBatch);
        }
      } catch (e: any) {
          this.log('ERROR', `Error fetching/processing signatures: ${e.message}`, { before: beforeSignature, error: e });
          // Stop on error to allow for investigation. A production system might have more advanced retry logic.
          hasMore = false;
      }
    }
    
    this.log('INFO', 'Indexer run finished.', { totalSignaturesScanned, totalAccountsDiscovered });
  }

  /**
   * Parses a single transaction to find a `createAccount` instruction sponsored by the operator.
   * @returns true if a new account was discovered, false otherwise.
   */
  private parseTransaction(tx: ParsedTransactionWithMeta): boolean {
    const feePayer = tx.transaction.message.accountKeys[0];
    // The operator must be the fee payer for it to be a sponsored transaction.
    if (!feePayer.signer || feePayer.pubkey.toBase58() !== this.config.operator.toBase58()) {
      return false;
    }

    let discovered = false;
    for (const instruction of tx.transaction.message.instructions) {
      if (isParsedInstruction(instruction) && instruction.programId.equals(SystemProgram.programId)) {
        if (instruction.parsed?.type === 'createAccount') {
          const { from, newAccount } = instruction.parsed.info;
          // The creator ('from') must also be the operator.
          if (from === this.config.operator.toBase58()) {
            this.storeSponsoredAccount({
                account_pubkey: newAccount,
                creation_signature: tx.transaction.signatures[0],
                slot: tx.slot,
                operator_pubkey: this.config.operator.toBase58(),
            });
            discovered = true;
          }
        }
      }
    }
    return discovered;
  }

  /**
   * Idempotently inserts a discovered sponsored account into the database.
   */
  private storeSponsoredAccount(account: {
    account_pubkey: string;
    creation_signature: string;
    slot: number;
    operator_pubkey: string;
  }): void {
    if (this.config.dryRun) {
        this.log('INFO', '[Dry Run] Would discover sponsored account.', account);
        return;
    }
    
    try {
        this.db.prepare(
            `INSERT INTO sponsored_accounts (account_pubkey, creation_signature, slot, operator_pubkey)
             VALUES (@account_pubkey, @creation_signature, @slot, @operator_pubkey)
             ON CONFLICT(account_pubkey) DO NOTHING`
        ).run(account);
        
        this.log('INFO', 'Discovered new sponsored account.', account);

    } catch (e: any) {
        this.log('ERROR', 'Failed to store sponsored account.', { account, error: e });
    }
  }

  private getCursor(): string | undefined {
    const row = this.db.prepare('SELECT value FROM system_kv_store WHERE key = ?').get(SIGNATURE_CURSOR_KEY);
    const cursor = row ? (row as any).value : undefined;
    if (cursor) {
        this.log('INFO', 'Resuming scan from cursor.', { cursor });
    }
    return cursor;
  }

  private saveCursor(signature: string): void {
    if (this.config.dryRun) {
      this.log('INFO', '[Dry Run] Would save new cursor.', { cursor: signature });
      return;
    }
    this.db.prepare('INSERT OR REPLACE INTO system_kv_store (key, value) VALUES (?, ?)')
      .run(SIGNATURE_CURSOR_KEY, signature);
    this.log('INFO', 'Cursor updated.', { cursor: signature });
  }
  
  public close(): void {
    AppDatabase.close();
  }
}
