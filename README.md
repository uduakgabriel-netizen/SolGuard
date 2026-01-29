
# SolGuard – Kora Rent Intelligence Engine

## Problem Statement

Kora makes it easy for apps to sponsor transactions and account creation on Solana, improving user experience by eliminating the need for users to hold SOL. However, this convenience introduces a hidden cost: **rent-locked SOL**.

When a Kora node sponsors account creation, SOL is locked as rent. Over time, many of these accounts become inactive, closed, or no longer needed. Operators often lack an automated way to track or reclaim this rent, leading to **silent capital loss**.

The problem: how can Kora operators **automatically monitor, track, and safely reclaim rent-locked SOL** from sponsored accounts without manual inspection or guesswork?

---

## Solution Overview

**SolGuard** is a fully automated, production-grade CLI tool that:

- Monitors sponsored accounts on Solana
- Evaluates lifecycle state of accounts
- Applies configurable policy rules to determine reclaimability
- Executes safe reclamation of rent SOL
- Produces detailed reports and cryptographic proofs for verification

SolGuard helps operators recover lost rent with **clarity, auditability, and safety**.

---

## How SolGuard Solves This Problem (Stage-by-Stage)

SolGuard’s design consists of six stages:

1. **Stage 1 – Indexer (Discovery)**  
   Scans blockchain history for accounts sponsored by the given operator and stores them in the local database.

2. **Stage 2 – Lifecycle Scan (Analysis)**  
   Verifies on-chain status of each discovered account: active, closed, or inactive.

3. **Stage 3 – Policy Evaluation (Decision Making)**  
   Applies safety and reclaimability rules (minimum lamports, age, whitelists) to classify accounts.

4. **Stage 4 – Reclamation (Action)**  
   Performs SOL reclaim transactions in batches with dry‑run mode and full safety checks.

5. **Stage 5 – Reporting (Audit & Transparency)**  
   Generates human‑readable reports summarizing account states and reclaimable balances.

6. **Stage 6 – Attestation & Proof (Verification)**  
   Produces a cryptographic proof of all operations for reliable verification by auditors or judges.

---

## Installation

### Prerequisites

- **Node.js v18+**
- **npm**
- **Git**
- Optional: TypeScript and ts‑node (`npm install -g typescript ts-node`)
- Internet access for Solana RPC

---

### Windows

1. Install Node.js (v18+) from https://nodejs.org
2. Clone the repo:
```powershell
git clone https://github.com/uduakgabriel-netizen/SolGuard.git
cd SolGuard\solguard
````

3. Install dependencies:

```powershell
npm install
```

---

### Linux / macOS

1. Ensure Node.js and npm are installed.
2. Clone the repo:

```bash
git clone https://github.com/uduakgabriel-netizen/SolGuard.git
cd SolGuard/solguard
```

3. Install dependencies:

```bash
npm install
```

---

## Usage (Quick Start)

Replace `<YOUR_PUBLIC_KEY>` and `<PATH_TO_KEYPAIR_JSON>` with your Solana wallet public key and keypair path.

### Stage 1 – Indexer

```bash
npx ts-node src/cli/index.ts scan --network devnet --operator <YOUR_PUBLIC_KEY>
```

### Stage 2 – Lifecycle Scan

```bash
npx ts-node src/cli/index.ts lifecycle scan --network devnet
```

### Stage 3 – Policy Evaluation

```bash
npx ts-node src/cli/index.ts policy evaluate --network devnet --min-lamports 0 --min-age-days 0
```

### Stage 4 – Reclamation (Dry Run)

```bash
npx ts-node src/cli/index.ts reclaim execute --network devnet --keypair <PATH_TO_KEYPAIR_JSON> --dry-run
```

### Stage 5 – Reporting

```bash
npx ts-node src/cli/index.ts report --network devnet --format text
```

### Stage 6 – Attestation & Proof

```bash
npx ts-node src/cli/index.ts attest generate --network devnet --output proof.json --keypair <PATH_TO_KEYPAIR_JSON>
npx ts-node src/cli/index.ts attest verify --file proof.json
```

---

## Expected Output (Per Stage)

| Stage          | Output                                                    |
| -------------- | --------------------------------------------------------- |
| Indexer        | Logs discovered sponsored accounts and initializes the DB |
| Lifecycle Scan | Annotates account states (ACTIVE, CLOSED, etc.)           |
| Policy Eval    | Shows which accounts are RECLAIMABLE                      |
| Reclamation    | Shows summary of reclaimed SOL (0 on dry‑run)             |
| Reporting      | Human‑readable metrics and logs                           |
| Attestation    | Cryptographically verifiable proof file                   |

---

## Safety Guarantees

* **Dry‑run mode**: Safely simulate reclaim without transactions
* **Policy rules**: Protect accounts from unsafe reclamation
* **Batch execution**: Efficient transaction grouping
* **Audit logs**: Full persistent logs with reasons and evidence

---

## Attestation & Proof

SolGuard generates an attestation file (`proof.json`), which is:

* Immutable
* Verifiable independently
* Provides a full audit of what happened and why

Verify proof:

```bash
npx ts-node src/cli/index.ts attest verify --file proof.json
```

---

## Known Limitations

* Requires Solana RPC (network must be reachable)
* Dry run does not reclaim real SOL
* Mainnet use must be done with care (real funds)
* `better-sqlite3` may require platform‑specific rebuilds

---

## Why This Meets the Kora Bounty Requirements

* Automates tracking of sponsored accounts
* Applies lifecycle checks and policy rules
* Reclaims eligible rent SOL safely
* Produces clear reports and cryptographic proofs
* Works across operating systems and environments

**SolGuard is not a guesswork bot — it is a safe, auditable, and production‑ready rent intelligence engine.**
A result showing zero reclaimed SOL is still considered a valid and correct outcome if no eligible accounts exist.

---

## Judge Cheat Sheet – Quick Verification (Devnet)

Follow these commands in order. Replace values where needed.

### Stage 1 – Indexer

```bash
npx ts-node src/cli/index.ts scan --network devnet --operator <YOUR_PUBLIC_KEY>
```

**Expected:** Logs of discovery and DB initialization.

### Stage 2 – Lifecycle Scan

```bash
npx ts-node src/cli/index.ts lifecycle scan --network devnet
```

**Expected:** Lifecycle statuses processed.

### Stage 3 – Policy Evaluation

```bash
npx ts-node src/cli/index.ts policy evaluate --network devnet --min-lamports 0 --min-age-days 0
```

**Expected:** RECLAIMABLE categories identified (or zero).

### Stage 4 – Reclamation (Dry Run)

```bash
npx ts-node src/cli/index.ts reclaim execute --network devnet --keypair <PATH_TO_KEYPAIR_JSON> --dry-run
```

**Expected:** No real transactions, summary of what *would* be reclaimed.

### Stage 5 – Reporting

```bash
npx ts-node src/cli/index.ts report --network devnet --format text
```

**Expected:** Human‑readable metrics (0 is a valid result).

### Stage 6 – Attestation & Proof

```bash
npx ts-node src/cli/index.ts attest generate --network devnet --output proof.json --keypair <PATH_TO_KEYPAIR_JSON>
npx ts-node src/cli/index.ts attest verify --file proof.json
```

**Expected:** `proof.json` created; verification PASS: `✅ verification PASS`.

**Notes for Judges:**

* Use Devnet for easy validation.
* Dry run avoids real fund movement.
* Database logs are persistent in `kora-rent-devnet.db`.

