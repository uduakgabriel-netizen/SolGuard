"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const index_1 = require("./index");
async function verifyDeterminism() {
    console.log('[Test] Verifying Reporting Determinism...');
    const dbPath = path_1.default.join(process.cwd(), 'kora-rent-devnet.db');
    // Ensure DB exists or create a temp one with dummy data?
    // For this stage, we assume the user has a DB or we can treat an empty DB as sufficient for "structure determinism".
    // If DB misses, AppDatabase creates it.
    // We'll use the existing devnet db if present, or a temp one.
    // If kora-rent-devnet.db doesn't exist, we might be testing on empty.
    const out1 = path_1.default.join(process.cwd(), 'report_run_1.json');
    const out2 = path_1.default.join(process.cwd(), 'report_run_2.json');
    const engine1 = new index_1.ReportingEngine({
        dbPath,
        network: 'devnet',
        format: 'json',
        outputFile: out1
    });
    const engine2 = new index_1.ReportingEngine({
        dbPath,
        network: 'devnet',
        format: 'json',
        outputFile: out2
    });
    console.log('[Test] Generating Run 1...');
    engine1.generate();
    console.log('[Test] Generating Run 2...');
    engine2.generate();
    const content1 = fs_1.default.readFileSync(out1, 'utf-8');
    const content2 = fs_1.default.readFileSync(out2, 'utf-8');
    // Parse to ignore potential non-deterministic key ordering if JS engine varies, 
    // although JSON.stringify is usually deterministic for same object structure.
    // But "byte-for-byte" in prompt implies exact string match.
    if (content1 !== content2) {
        console.error('[FAILED] Determinism check failed!');
        console.error('Run 1 length:', content1.length);
        console.error('Run 2 length:', content2.length);
        // Detailed diff if small
        if (content1.length < 1000) {
            console.error('Run 1:', content1);
            console.error('Run 2:', content2);
        }
        process.exit(1);
    }
    else {
        console.log('[SUCCESS] Reports are byte-for-byte identical.');
    }
    // Cleanup
    fs_1.default.unlinkSync(out1);
    fs_1.default.unlinkSync(out2);
}
verifyDeterminism().catch(e => {
    console.error(e);
    process.exit(1);
});
