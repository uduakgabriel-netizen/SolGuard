"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResultBuilder = void 0;
exports.stringifyResult = stringifyResult;
const utils_1 = require("./utils");
class ResultBuilder {
    constructor() {
        this.accounts = {};
        this.totalLamports = BigInt(0);
        this.signatures = [];
        this.failures = [];
    }
    addResult(pubkey, state, lamportsRecalimed = 0) {
        this.accounts[pubkey] = state;
        this.totalLamports += BigInt(lamportsRecalimed);
    }
    addSignature(signature) {
        this.signatures.push(signature);
    }
    addFailure(pubkey, reason) {
        this.failures.push({ pubkey, reason });
    }
    build() {
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
exports.ResultBuilder = ResultBuilder;
function stringifyResult(result) {
    return JSON.stringify((0, utils_1.canonicalize)(result));
}
