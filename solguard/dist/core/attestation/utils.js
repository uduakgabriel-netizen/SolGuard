"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canonicalize = canonicalize;
/**
 * Recursively sorts object keys to ensure deterministic JSON serialization.
 */
function canonicalize(obj) {
    if (Array.isArray(obj)) {
        return obj.map(canonicalize);
    }
    else if (typeof obj === 'object' && obj !== null) {
        return Object.keys(obj).sort().reduce((acc, key) => {
            acc[key] = canonicalize(obj[key]);
            return acc;
        }, {});
    }
    return obj;
}
