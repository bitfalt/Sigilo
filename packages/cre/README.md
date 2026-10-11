# Sigilo payday workflow (Chainlink CRE)

Sigilo's operator publishes payroll registry roots on Monad (`SigiloRegistry.publishRoot`), and every
Income Passport is proven against them. Payroll-deducted advances (`AdvanceVault`) are repaid by
employers' payroll runs. Until now Sigilo was the only one vouching for either. This CRE workflow is
the orchestration layer between Sigilo's backend, Monad and the lender: a decentralized oracle network
(DON) independently rebuilds the registry tree from the public leaves, checks it against the root on
Monad, checks every advance against its vault, and writes one signed report to `SigiloOracle`.

```
                 ┌──────────── triggers ────────────┐
                 │ cron "0 0 12 1 * *" (payday, UTC)│
                 │ SigiloRegistry.RootPublished     │  (EVM log, finalized)
                 └────────────────┬─────────────────┘
                                  ▼
 Monad testnet  ◄── EVM read ── payday workflow ── HTTP GET (every node) ──►  Sigilo backend
 SigiloRegistry     (Multicall3,  │  ▲              consensus on the         GET /cre/payday
  latestRoot,        finalized)   │  │              rebuilt Poseidon2 tree    public leaves +
  rootCount,                      │  └─ each node rebuilds the depth-16      advances due
  isKnownRoot                     │     registry tree in QuickJS/WASM
 AdvanceVault.advances(id)        ▼
                          DON-signed report ── EVM write (forwarder) ──►  SigiloOracle
                                                                            rootCheckedAt[root]
                                                                            lateSince[vault][id]
```

1. **Trigger.** A monthly payday cron, and the `RootPublished` event (indexed `root` and `index`)
   of `SigiloRegistry` (`0xba306ac85e31D43b92bc1915fF84354A08140A8B`). Two handlers, one workflow.
2. **External system.** Every node fetches `GET {backendUrl}` (`apps/web/convex/cre.ts`): the registry
   leaves in tree order and, per advance, `{ vault, advanceId, expectedRepaid, period }`
   (`expectedRepaid` = one installment per month boundary since the worker signed the deduction
   mandate, capped at what she owes, in AUSD base units). Each node validates it strictly and
   rebuilds the tree itself; only the derived observation (leaf count, rebuilt root, matching
   prefix, advances) goes through identical-value consensus.
3. **Cross-check.** The root under audit (the event's root, or `latestRoot` on payday) must equal the
   Poseidon2 root of a prefix of the public leaves (same tree as `packages/core/src/merkle.ts`: depth
   16, `H(5, left, right)`, empty leaf 0). The prefix search tries `index + 1` first (one leaf per
   publish), then the newest `rootSearchWindow + 1` lengths. Each advance is read from its vault;
   it is **late** when it is still open and `repaid < expectedRepaid`.
4. **Report → Monad.** One report (DON time, root checks, installment statuses; layout below),
   delivered by the Chainlink forwarder to `SigiloOracle` (`packages/contracts/src/SigiloOracle.sol`),
   which records `rootCheckedAt` / `rootMismatchAt` and `lateSince`, and emits `RootChecked`,
   `RootMismatch`, `InstallmentLate`, `InstallmentCaughtUp`.

```solidity
abi.encode(
    uint64 observedAt,                                                 // DON time, unix seconds
    (bytes32 root, uint32 leafCount, bool consistent)[] roots,
    (address vault, uint256 advanceId, uint32 period, bool late)[] installments
)
```

## Privacy boundary

The endpoint only serves what is already public or names nobody: registry leaves (also served by
`registry.leaves`) and, per advance, the vault, its on-chain id, an amount and a month. Never
employers, names, salaries, employee ids, lender names, or anything that links an advance to an
employer. The workflow enforces this from its side too: the payload schema is strict, so an extra
field (say, `employer`) makes the run fail instead of being passed along. Nothing private reaches
the DON, the logs or the chain.

## Layout

| Path                      | What                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `project.yaml`            | Targets and the Monad testnet RPC (`monad-testnet`, selector `2183018362218727504`) |
| `secrets.yaml`            | Empty: the workflow uses no secrets                                                 |
| `payday/workflow.yaml`    | `local-simulation`, `staging-settings`, `production-settings`                       |
| `payday/main.ts`          | Entry point (`Runner` + `initWorkflow`)                                             |
| `payday/workflow.ts`      | Config schema, both handlers, the audit                                             |
| `payday/backend.ts`       | Node-mode HTTP fetch, strict payload validation, observation                        |
| `payday/registry.ts`      | Poseidon2 registry tree (mirrors `packages/core`)                                   |
| `payday/chain.ts`         | Multicall3 reads of `SigiloRegistry` and `AdvanceVault`                             |
| `payday/report.ts`        | Report encoding, late rule, gas sizing                                              |
| `payday/workflow.test.ts` | Pinned vectors, cross-check with core, mocked end-to-end runs                       |

## Setup

Prerequisites: the CRE CLI (`cre login` done in the browser; `cre whoami` works), Bun ≥ 1.2.21, and
the monorepo installed (`pnpm install` at the repo root; the tests cross-check against
`packages/core`).

```bash
cd packages/cre/payday
bun install
bunx cre-setup
bun test          # 22 tests: vectors, payload rules, report encoding, mocked runs
```

## Simulate (no transaction, no report)

Run from `packages/cre` (the directory with `project.yaml`). The `local-simulation` target does the
real HTTP fetch, consensus and Monad reads, then logs what it would write and stops before creating a
report.

```bash
# Handler 0: payday cron
cre workflow simulate payday --target local-simulation --non-interactive --trigger-index 0

# Handler 1: a real RootPublished (index 37, root 0x07aaf043…) on Monad testnet
cre workflow simulate payday --target local-simulation --non-interactive --trigger-index 1 \
  --evm-tx-hash 0xdb4fe0add0e422059879f1f9ccea8c0c9274ebb205a2513b42320eaa497df055 --evm-event-index 0
```

Expected log lines (dev backend, 2026-10-11):

```
[USER LOG] [registry] rootCount=38 latestRoot=0x07aaf04388f1bd397d46b5a817d48cc01efa82899493afd675a53fbc8efee0fa
[USER LOG] [backend] leaves=38 rebuiltRoot=0x07aaf04388f1bd397d46b5a817d48cc01efa82899493afd675a53fbc8efee0fa advances=2
[USER LOG] [check] root 0x07aaf043… = Poseidon2 tree of the first 38 public leaves (OK)
[USER LOG] [advance] 0xdB38A7F37f45934A42f4ddD740d8F69414de7734#2 repaid $2.30 of $4.59, due $0.00 by period 24321, on schedule
[USER LOG] [local-simulation] would report 1 root check(s) and 2 installment status(es) (0 late), 512 bytes, gas limit 390000; no report created
```

Never use the `local-simulation` target with `--broadcast`, `deploy`, `update` or `activate`.

## Broadcast a real report (later)

`--broadcast` sends a real Monad testnet transaction through the `MockKeystoneForwarder`
(`0xB9F79d863261869B234c481D1f9A7af84AeAd192`). Prerequisites:

1. A funded Monad testnet key in the CLI's environment as `CRE_ETH_PRIVATE_KEY` (for example in
   `packages/cre/.env`, which is git-ignored). Provided by you; never paste it into a chat or commit
   it. Each report's gas limit is sized to its content (`report.ts` `gasLimitFor`: 200k + 100k per
   root + 45k per advance; Monad bills the limit), about 390k gas for today's data.
2. `SigiloOracle` deployed with the mock forwarder: `cd packages/contracts && pnpm deploy:oracle`
   (needs `DEPLOYER_PRIVATE_KEY` in the root `.env`; a dry run without `--broadcast` estimated
   ~1.7M gas). Do **not** call `setExpectedAuthor` / `setExpectedWorkflowId` while using the mock:
   it does not pass workflow metadata the way the production forwarder does.
3. The oracle address in `payday/config.staging.json` (`oracleAddress`). The `staging-settings`
   target is `mode: "production"`; it fails closed while `oracleAddress` is empty.
4. A passing non-broadcast run of the same target first, then:

```bash
cre workflow simulate payday --target staging-settings --non-interactive --trigger-index 0 --broadcast
```

## Deploy to the CRE network (later)

Needs CRE Early Access (`cre account access`; this account shows "Deploy Access: Not enabled"), a
linked funded key (`cre account link-key --target production-settings`), and a registry ID from
`cre registry list` in `payday/workflow.yaml` instead of `"private"`. Point `SigiloOracle` at the
production `KeystoneForwarder` (`setForwarderAddress(0xF8344CFd5c43616a4366C34E3EEE75af79a74482)`) and
pin the workflow with `setExpectedAuthor` and `setExpectedWorkflowId`; then
`cre workflow deploy payday --target production-settings` and `cre workflow activate payday --target
production-settings`.

## Limits and notes

- CRE limits that shape the design (`cre workflow limits export`): 15 chain reads per run (one
  Multicall3 for the registry + one per 10 advances, so `maxAdvances` ≤ 120), 5 kB per read, 25 kB
  consensus observation (the leaves never go through consensus, only the rebuilt root), 250 kB HTTP
  response (~3,500 leaves).
- Poseidon2 runs in the WASM sandbox with `@zkpassport/poseidon2` (pure TypeScript bigint, the same
  library `packages/core` uses). Measured in the simulator: ~0.45 ms per hash; a 1,024-leaf tree in
  468 ms, today's 38 leaves in ~20 ms.
- The dev and prod backends publish to the same `SigiloRegistry`. A workflow pointed at one backend
  reports roots published by the other as `RootMismatch`, which is the correct answer for that
  backend's leaves; use one registry per backend in production.
- The endpoint checks the 64 newest deduction mandates (active and completed, so a late flag can be
  cleared once the vault is repaid).
