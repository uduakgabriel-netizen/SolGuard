#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/cli/index.ts
const commander_1 = require("commander");
const web3_js_1 = require("@solana/web3.js");
const indexer_1 = require("../core/indexer");
const lifecycle_1 = require("../core/lifecycle");
const policy_1 = require("../core/policy");
const index_1 = require("../core/reclaimer/index");
const web3_js_2 = require("@solana/web3.js");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// Define network RPC endpoints
const RPC_ENDPOINTS = {
    devnet: 'https://api.devnet.solana.com',
    mainnet: 'https://api.mainnet-beta.solana.com', // Use a dedicated RPC for production
};
const program = new commander_1.Command();
program
    .name('kora-rent-reclaimer')
    .description('Stage 1: A robust, resumable discovery engine for Solana sponsored accounts.')
    .version('1.0.0');
program
    .command('scan')
    .description('Scan the transaction history of an operator to discover sponsored accounts.')
    .requiredOption('-o, --operator <pubkey>', 'The Kora operator public key that sponsored the accounts.')
    .option('-r, --rpc <url>', 'Optional custom RPC URL to override the network default.')
    .option('-n, --network <type>', 'The network to scan (devnet or mainnet).', 'devnet')
    .option('--dry-run', 'Simulate all actions without writing to the database.', false)
    .action(async (options) => {
    console.log('Kora Rent Intelligence Engine - Stage 1: Indexer');
    console.log('----------------------------------------------------');
    // --- Configuration Validation ---
    let operatorKey;
    try {
        operatorKey = new web3_js_1.PublicKey(options.operator);
    }
    catch (e) {
        console.error('Error: Invalid operator public key provided.');
        process.exit(1);
    }
    if (options.network !== 'devnet' && options.network !== 'mainnet') {
        console.error("Error: Invalid network specified. Use 'devnet' or 'mainnet'.");
        process.exit(1);
    }
    // Determine RPC endpoint
    const rpcUrl = options.rpc || RPC_ENDPOINTS[options.network];
    // Safety check for mainnet
    if (options.network === 'mainnet') {
        console.warn('[WARNING] Running on mainnet-beta. Ensure you are using a dedicated, reliable RPC endpoint.');
    }
    console.log(`[Config] Operator: ${operatorKey.toBase58()}`);
    console.log(`[Config] Network: ${options.network}`);
    console.log(`[Config] RPC Endpoint: ${rpcUrl}`);
    console.log(`[Config] Mode: ${options.dryRun ? 'Dry Run (no DB writes)' : 'Live'}`);
    console.log('----------------------------------------------------');
    // --- Initialization & Execution ---
    const dbPath = path_1.default.join(process.cwd(), `kora-rent-${options.network}.db`);
    const indexer = new indexer_1.Indexer({
        operator: operatorKey,
        rpcUrl: rpcUrl,
        dbPath: dbPath,
        dryRun: options.dryRun,
    });
    try {
        await indexer.run();
    }
    catch (error) {
        console.error('[CRITICAL] An unexpected error occurred during the scan:', error);
        process.exit(1);
    }
    finally {
        indexer.close();
        console.log('Indexer run has concluded.');
    }
});
const lifecycle = program.command('lifecycle')
    .description('Stage 2: Lifecycle Intelligence Engine');
lifecycle
    .command('scan')
    .description('Determine the current lifecycle state of discovered accounts via on-chain analysis.')
    .option('-r, --rpc <url>', 'Optional custom RPC URL.')
    .option('-n, --network <type>', 'The network to scan (devnet or mainnet).', 'devnet')
    .option('--dry-run', 'Simulate actions without DB writes.', false)
    .action(async (options) => {
    console.log('Kora Rent Intelligence Engine - Stage 2: Lifecycle Scan');
    console.log('-------------------------------------------------------');
    // Config
    const rpcUrl = options.rpc || RPC_ENDPOINTS[options.network];
    const dbPath = path_1.default.join(process.cwd(), `kora-rent-${options.network}.db`);
    console.log(`[Config] Network: ${options.network}`);
    console.log(`[Config] RPC: ${rpcUrl}`);
    console.log(`[Config] Mode: ${options.dryRun ? 'Dry Run' : 'Live'}`);
    const engine = new lifecycle_1.LifecycleEngine({
        rpcUrl,
        dbPath,
        dryRun: options.dryRun
    });
    try {
        await engine.scan();
    }
    catch (e) {
        console.error('[CRITICAL] Lifecycle scan failed:', e);
        process.exit(1);
    }
    finally {
        engine.close();
    }
});
const policy = program.command('policy')
    .description('Stage 3: Policy & Safety Engine');
policy
    .command('evaluate')
    .description('Evaluate discovered accounts against safety policies to mark them as RECLAIMABLE.')
    .option('-n, --network <type>', 'The network to scan (devnet or mainnet).', 'devnet')
    .option('--dry-run', 'Simulate actions without DB writes.', false)
    .option('--min-lamports <number>', 'Minimum lamports required to mark as reclaimable (dust filter).', '0')
    .option('--min-age-days <number>', 'Minimum days since last lifecycle check to allow reclaim.', '0')
    .option('--whitelist <path>', 'Path to a text file containing whitelisted pubkeys (one per line).')
    .action(async (options) => {
    console.log('Kora Rent Intelligence Engine - Stage 3: Policy Evaluation');
    console.log('----------------------------------------------------------');
    // Config
    const dbPath = path_1.default.join(process.cwd(), `kora-rent-${options.network}.db`);
    let whitelist = [];
    if (options.whitelist) {
        try {
            const content = fs_1.default.readFileSync(path_1.default.resolve(options.whitelist), 'utf-8');
            whitelist = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            console.log(`[Config] Loaded whitelist: ${whitelist.length} entries.`);
        }
        catch (e) {
            console.error(`Error loading whitelist file: ${e}`);
            process.exit(1);
        }
    }
    console.log(`[Config] Network: ${options.network}`);
    console.log(`[Config] Mode: ${options.dryRun ? 'Dry Run' : 'Live'}`);
    console.log(`[Config] Min Lamports: ${options.minLamports}`);
    console.log(`[Config] Min Age Days: ${options.minAgeDays}`);
    const engine = new policy_1.PolicyEngine({
        dbPath,
        dryRun: options.dryRun,
        minLamports: parseInt(options.minLamports, 10),
        minAgeDays: parseInt(options.minAgeDays, 10),
        whitelist
    });
    try {
        await engine.evaluate();
    }
    catch (e) {
        console.error('[CRITICAL] Policy evaluation failed:', e);
        process.exit(1);
    }
    finally {
        engine.close();
    }
});
const reclaimer = program.command('reclaim')
    .description('Stage 3/4: Reclamation Executor');
reclaimer
    .command('execute')
    .description('Execute reclamation for accounts marked as RECLAIMABLE.')
    .option('-r, --rpc <url>', 'Optional custom RPC URL.')
    .option('-n, --network <type>', 'The network to scan (devnet or mainnet).', 'devnet')
    .option('--dry-run', 'Simulate actions without DB writes.', false)
    .option('-k, --keypair <path>', 'Path to operator keypair definition (JSON) for signing transactions.')
    .action(async (options) => {
    console.log('Kora Rent Intelligence Engine - Stage 3/4: Reclamation Executor');
    console.log('---------------------------------------------------------------');
    // Config
    const rpcUrl = options.rpc || RPC_ENDPOINTS[options.network];
    const dbPath = path_1.default.join(process.cwd(), `kora-rent-${options.network}.db`);
    let operatorKeypair;
    if (!options.dryRun) {
        if (!options.keypair) {
            console.error('Error: Operator keypair (-k) is REQUIRED for live execution.');
            process.exit(1);
        }
        try {
            const keyContent = fs_1.default.readFileSync(path_1.default.resolve(options.keypair), 'utf-8');
            operatorKeypair = web3_js_2.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(keyContent)));
        }
        catch (e) {
            console.error('Error loading keypair:', e);
            process.exit(1);
        }
    }
    console.log(`[Config] Network: ${options.network}`);
    console.log(`[Config] RPC: ${rpcUrl}`);
    console.log(`[Config] Mode: ${options.dryRun ? 'Dry Run' : 'LIVE EXECUTOR'}`);
    if (operatorKeypair) {
        console.log(`[Config] Operator: ${operatorKeypair.publicKey.toBase58()}`);
    }
    const engine = new index_1.ReclaimerOrchestrator({
        dbPath,
        rpcUrl,
        dryRun: options.dryRun,
        operatorKeypair,
        batchSize: 100 // Default batch size for scalability
    });
    try {
        await engine.execute();
    }
    catch (e) {
        console.error('[CRITICAL] Reclamation execution failed:', e);
        // Ensure we attempt to close even on error if the orchestrator supports it
        engine.close();
        process.exit(1);
    }
});
program.parse(process.argv);
