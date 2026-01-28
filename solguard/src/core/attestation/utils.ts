
/**
 * Recursively sorts object keys to ensure deterministic JSON serialization.
 */
export function canonicalize(obj: any): any {
    if (Array.isArray(obj)) {
        return obj.map(canonicalize);
    } else if (typeof obj === 'object' && obj !== null) {
        return Object.keys(obj).sort().reduce((acc: any, key) => {
            acc[key] = canonicalize(obj[key]);
            return acc;
        }, {});
    }
    return obj;
}
