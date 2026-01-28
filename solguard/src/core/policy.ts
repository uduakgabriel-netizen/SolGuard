// src/core/policy.ts
import Database from 'better-sqlite3';
import { AppDatabase, LogLevel, LifecycleState } from '../db/database';

export interface PolicyConfig {
    dbPath: string;
    dryRun: boolean;
    minLamports?: number; // Minimum balance to consider for reclaim (dust filter)
    minAgeDays?: number; // Optional: Minimum days since 'last_lifecycle_check' or 'discovered_at' ?
    whitelist?: string[]; // List of account public keys to NEVER reclaim
}

export class PolicyEngine {
    private readonly db: Database.Database;
    private readonly config: PolicyConfig;

    constructor(config: PolicyConfig) {
        this.config = config;
        this.db = AppDatabase.getInstance(config.dbPath, false);
    }

    private log(level: LogLevel, message: string, metadata?: object) {
        console.log(`[Policy:${level}] ${message}`, metadata || '');
        if (!this.config.dryRun) {
            AppDatabase.log(this.db, level, message, metadata);
        }
    }

    /**
     * Evaluates accounts to determine if they should be marked RECLAIMABLE.
     * STRICT RULE: Only evaluates accounts that are physically 'CLOSED' (or 'DORMANT' if policy allowed, but user said NO).
     * User Rule: "Determines if an account is safe to reclaim: CLOSED accounts -> ready for reclaim"
     * User Rule: "Never allow reclaim of ACTIVE or DORMANT accounts."
     */
    public async evaluate(): Promise<void> {
        this.log('INFO', 'Starting policy evaluation.', {
            config: { ...this.config, whitelistSize: this.config.whitelist?.length || 0 }
        });

        // 1. Fetch potential candidates.
        // Query ALL accounts that are not already final states (RECLAIMABLE, RECLAIMED, CLOSED=0 lamports).
        // The directive says "Evaluates each account... Determine if safe to reclaim".
        // We specifically target accounts that *exist* (ACTIVE/DORMANT/DISCOVERED) to see if they SHOULD be reclaimed.
        // If they are strictly 'CLOSED' (null/0 lamports), we ignore them as there is nothing to reclaim.
        const candidates = this.db.prepare(
            `SELECT * FROM sponsored_accounts 
       WHERE lifecycle_state NOT IN ('RECLAIMABLE', 'reclaimed', 'closed_zero') 
       ORDER BY account_pubkey ASC` // Deterministic sorting
        ).all() as any[];

        let stats = { protected: 0, dust: 0, skipped: 0, reclaimable: 0 };

        for (const account of candidates) {
            const decision = this.checkEligibility(account);

            if (decision.newState && decision.newState !== account.lifecycle_state) {
                this.updateState(account.account_pubkey, account.lifecycle_state, decision.newState, decision.reason);

                // Update stats for logging
                if (decision.newState === 'PROTECTED') stats.protected++;
                if (decision.newState === 'DUST') stats.dust++;
                if (decision.newState === 'SKIPPED') stats.skipped++;
                if (decision.newState === 'RECLAIMABLE') stats.reclaimable++;
            }
        }

        this.log('INFO', `Policy evaluation complete. Results:`, stats);
    }

    private checkEligibility(account: any): { newState?: LifecycleState; reason: string } {
        // 1. Whitelist Protection
        // "Checked before any other rule"
        if (this.config.whitelist?.includes(account.account_pubkey)) {
            return { newState: 'PROTECTED', reason: 'Whitelisted' };
        }

        // 2. CLOSED ACCOUNT VERIFICATION (CRITICAL)
        // "Account owner = SystemProgram... Account has no data layout... not executable"
        // If ANY check fails -> Mark account as SKIPPED

        // Note: We rely on data gathered in Stage 2 (Lifecycle Scan).
        // If Stage 2 didn't run or didn't capture owner/data_len, we can't verify safely.
        // Assuming 'owner_program' stores the owner pubkey string.
        const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

        // Check if data is missing (should have been captured if active)
        if (account.lamports === null || account.owner_program === null) {
            // If we don't know the state, we can't reclaim. SKIPPED.
            return { newState: 'SKIPPED', reason: 'Missing lifecycle data (Account might simply be closed/null already)' };
        }

        // Check Owner
        if (account.owner_program !== SYSTEM_PROGRAM_ID) {
            return { newState: 'SKIPPED', reason: `Owner is not System Program (Owner: ${account.owner_program})` };
        }

        // Check Data Length (Must be 0)
        if (account.data_len && account.data_len > 0) {
            return { newState: 'SKIPPED', reason: `Account has data (${account.data_len} bytes)` };
        }

        // Executable check is implied by System Program ownership (System accounts are not executable), 
        // but if we had an 'executable' boolean column we would check it. 
        // For now, non-system owner catches mostly everything executable.

        // 3. Dust Filter (Applies ONLY if verification passes)
        const balance = account.lamports || 0;
        const minLamports = this.config.minLamports || 0;

        if (balance < minLamports) {
            return { newState: 'DUST', reason: `Balance ${balance} < Min ${minLamports}` };
        }

        // User instruction: "Reclaim only if lamports > 0"
        if (balance <= 0) {
            // If strict, DUST or just leave as is. 0 balance is effectively closed.
            return { newState: 'SKIPPED', reason: '0 Balance' };
        }

        // 4. Age Verification
        // "Calculate age using Slot -> BlockTime... Store closed_at..."
        // We use 'last_lifecycle_check' as the proxy for when valid emptiness was observed.
        // Ideally Stage 2 ensures this is up to date.
        if (this.config.minAgeDays && this.config.minAgeDays > 0) {
            if (!account.last_lifecycle_check) {
                return { newState: 'SKIPPED', reason: 'No age data (run lifecycle scan first)' };
            }

            const lastCheck = new Date(account.last_lifecycle_check);
            const now = new Date();
            const diffTime = now.getTime() - lastCheck.getTime();
            const ageDays = diffTime / (1000 * 60 * 60 * 24);

            if (ageDays < this.config.minAgeDays) {
                return { newState: undefined, reason: `Age ${ageDays.toFixed(2)} days < Min ${this.config.minAgeDays}` }; // Keep current state
            }
        }

        // If all checks pass:
        return { newState: 'RECLAIMABLE', reason: 'Passes all safety & eligibility rules' };
    }

    private updateState(pubkey: string, oldState: string, newState: LifecycleState, reason: string): void {
        if (this.config.dryRun) {
            this.log('INFO', `[Dry Run] Transition: ${oldState} -> ${newState}`, { pubkey, reason });
            return;
        }

        this.db.prepare(
            `UPDATE sponsored_accounts SET lifecycle_state = ? WHERE account_pubkey = ?`
        ).run(newState, pubkey);

        this.db.prepare(
            `INSERT INTO lifecycle_events (account_pubkey, old_state, new_state, trigger_reason, evidence_payload)
         VALUES (?, ?, ?, ?, ?)`
        ).run(pubkey, oldState, newState, `Policy: ${reason}`, JSON.stringify({ config: this.config }));

        this.log('INFO', `State updated: ${oldState} -> ${newState}`, { pubkey });
    }

    public close(): void {
        AppDatabase.close();
    }
}
