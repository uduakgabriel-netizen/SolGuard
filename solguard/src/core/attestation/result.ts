import { canonicalize } from './utils';

export interface ExecutionResultDigest {
    evaluated_count: number;
    accounts: Record<string, string>; // pubkey -> final_state
    total_lamports_reclaimed: string; // use string for safety with large numbers
    transaction_signatures: string[];
    failures: Array<{ pubkey: string; reason: string }>;
}

export class ResultBuilder {
    private accounts: Record<string, string> = {};
    private totalLamports = BigInt(0);
    private signatures: string[] = [];
    private failures: Array<{ pubkey: string; reason: string }> = [];

    addResult(pubkey: string, state: string, lamportsRecalimed: number | bigint = 0) {
        this.accounts[pubkey] = state;
        this.totalLamports += BigInt(lamportsRecalimed);
    }

    addSignature(signature: string) {
        this.signatures.push(signature);
    }

    addFailure(pubkey: string, reason: string) {
        this.failures.push({ pubkey, reason });
    }

    build(): ExecutionResultDigest {
        // Enforce deterministic sorting for failure list and signatures

        // Sort signatures
        const sortedSignatures = [...this.signatures].sort();

        // Sort failures by pubkey
        const sortedFailures = [...this.failures].sort((a, b) => a.pubkey.localeCompare(b.pubkey));

        // Accounts is a map, serialization will handle key sorting if using canonicalize, 
        // but let's just return the object.

        return {
            evaluated_count: Object.keys(this.accounts).length,
            accounts: this.accounts,
            total_lamports_reclaimed: this.totalLamports.toString(),
            transaction_signatures: sortedSignatures,
            failures: sortedFailures
        };
    }
}

export function stringifyResult(result: ExecutionResultDigest): string {
    return JSON.stringify(canonicalize(result));
}
