---
name: monad
description: Use when building, deploying, or integrating smart contracts on
  Monad; configuring wallets or RPC endpoints; running nodes; understanding
  Monad's architecture, consensus, or execution model; or optimizing
  applications for Monad's high-throughput EVM environment.
metadata:
  mintlify-proj: monad
  version: "1.0"
---

# Monad Skill Reference

## Product Summary

Monad is an Ethereum-compatible Layer-1 blockchain delivering 10,000 tps throughput, 300ms block frequency, and 600ms finality. It maintains full EVM bytecode compatibility (Fusaka fork) while introducing innovations in consensus (MonadBFT), block propagation (RaptorCast), asynchronous execution, parallel execution, and storage (MonadDb). Developers interact with Monad using standard Ethereum tools (Foundry, Hardhat, MetaMask) and the JSON-RPC API. Key files: `node.toml` (node configuration), deployment scripts (Foundry/Hardhat), contract ABIs. Primary docs: https://docs.monad.xyz

**Mainnet:** Chain ID 143, RPC `https://rpc.monad.xyz`, Explorer `https://monadvision.com`  
**Testnet:** Chain ID 10143, RPC `https://testnet-rpc.monad.xyz`, Faucet `https://faucet.monad.xyz`

## When to Use

Reach for this skill when:
- **Building smart contracts** — deploying ERC20, DEX, lending, or other contracts to Monad
- **Integrating wallets** — adding Monad to MetaMask, Privy, or other wallet infrastructure
- **Configuring RPC endpoints** — setting up JSON-RPC calls, WebSocket subscriptions, or execution events
- **Running infrastructure** — operating full nodes, validators, or archive servers
- **Optimizing performance** — reducing gas costs, batching calls, using indexers, or consuming real-time data
- **Understanding differences** — checking Monad-specific behavior vs Ethereum (gas pricing, storage pages, async execution, reserve balance)
- **Debugging transactions** — tracing execution, checking block states, or handling failed transactions

## Quick Reference

### Network Configuration

| Network | Chain ID | RPC URL | Block Explorer | Faucet |
|---------|----------|---------|----------------|--------|
| Mainnet | 143 | `https://rpc.monad.xyz` | https://monadvision.com | N/A |
| Testnet | 10143 | `https://testnet-rpc.monad.xyz` | https://testnet.monadvision.com | https://faucet.monad.xyz |

### Gas and Limits

| Parameter | Value |
|-----------|-------|
| Per-transaction gas limit | 30M gas |
| Block gas limit | 150M gas |
| Block frequency | 300 ms |
| Finality | 600 ms (2 blocks) |
| Min base fee | 100 MON-gwei |
| Memory per transaction | 8 MB max |
| Max contract size | 128 KB |

### Key Differences from Ethereum

| Feature | Monad | Ethereum |
|---------|-------|----------|
| Gas charged | Gas **limit** (not usage) | Gas **usage** |
| Storage access | Per 128-slot page | Per slot |
| Cold account access | 10,100 gas | 2,600 gas |
| Cold storage access | 8,100 gas per page | 2,100 gas per slot |
| Memory expansion | Linear (`w/2`) | Quadratic |
| P256 precompile | ✅ `0x0100` (EIP-7951) | ❌ |
| Staking precompile | ✅ `0x1000` | ❌ |
| EIP-4844 blobs | ❌ | ✅ |
| Block time | 300 ms | 12 sec |

### Deployment Tools

| Tool | Status | Notes |
|------|--------|-------|
| Foundry | ✅ | v1.8+ with `--execution-network monad` |
| Hardhat | ✅ | Use Monad network config |
| Remix | ✅ | Injected provider (MetaMask) |
| Viem | ✅ | v2.40.0+ |

### RPC Methods (Key Subset)

| Method | Notes |
|--------|-------|
| `eth_sendRawTransaction` | Async validation; may accept nonce gaps initially |
| `eth_call` | Max 200M gas; state availability limited (see historical data) |
| `eth_getLogs` | Max 100-1000 block range per provider |
| `eth_getTransactionByHash` | Returns `null` for pending txs (no global mempool) |
| `eth_subscribe` | WebSocket only; supports `newHeads`, `logs`, `monadNewHeads`, `monadLogs` |
| `debug_trace*` | Requires explicit trace options `{}` parameter |

## Decision Guidance

### When to Use X vs Y

| Scenario | Use | Why |
|----------|-----|-----|
| **Reading state** — single vs multiple calls | Multicall3 or batch | Avoid round-trip latency; Multicall3 at `0xcA11bde05977b3631167028862bE2a173976CA11` |
| **Estimating gas** — dynamic vs hardcoded | Hardcoded (if static) | Eliminates `eth_estimateGas` RPC call; speeds up UX |
| **Listening to events** — `eth_getLogs` vs indexer | Indexer (Envio, The Graph, Goldsky) | Avoids block range limits; enables complex queries |
| **Real-time data** — JSON-RPC vs WebSocket vs Execution Events | Execution Events (if co-located) | Lowest latency via shared memory; requires node on same host |
| **Block finality** — `latest` vs `safe` vs `finalized` | `finalized` for settlement | Irreversible without hard fork; use for bridges, deposits |
| **Nonce management** — per-call vs local tracking | Local tracking (if rapid txs) | Avoids `eth_getTransactionCount` overhead |
| **Transaction submission** — serial vs concurrent | Concurrent (Promise.all) | Improves throughput for batch operations |

## Workflow

### Deploying a Smart Contract

1. **Prepare environment** — Install Foundry v1.8+ or Hardhat; add Monad network config (chain ID 143 or 10143).
2. **Write contract** — Standard Solidity; note 128 KB max size, storage pages (128 slots), P256 precompile availability.
3. **Test locally** — Use Foundry with `--execution-network monad` to match Monad's gas pricing and opcodes.
4. **Deploy** — Use `forge create` (Foundry) or `hardhat run` (Hardhat) with Monad RPC and private key.
5. **Verify** — Use `forge verify-contract` or Hardhat verification plugin; submit to MonadVision or Monadscan.
6. **Confirm** — Check block explorer; wait for `Finalized` state (2 blocks, ~600ms) before relying on execution.

### Integrating Monad into a Wallet

1. **Check wallet support** — MetaMask, Privy, Ambire, and others support Monad natively.
2. **Add network** — Use wallet's network selector or manual entry: Chain ID 143, RPC `https://rpc.monad.xyz`, symbol MON.
3. **Test connectivity** — Send test transaction; verify in block explorer.
4. **Handle async execution** — Transactions are speculatively executed at `Proposed` state; wait for `Finalized` (2 blocks) for certainty.
5. **Implement block state tracking** — Use `monadNewHeads` WebSocket subscription to track block progression through consensus.

### Consuming Real-Time Data

1. **Choose method** — JSON-RPC (simplest), WebSocket (real-time), or Execution Events (lowest latency).
2. **For WebSocket** — Subscribe to `newHeads` or `monadNewHeads` (includes `commitState` field); handle speculative execution.
3. **For Execution Events** — Run consumer (C/Rust) on same host as Monad node; use shared memory queue.
4. **Handle reorgs** — Track `blockId` in `monadNewHeads`; when a block is `Finalized`, abandon other proposals at same height.

### Running a Full Node

1. **Check hardware** — 16-core CPU, 32 GB RAM, 2×2 TB NVMe SSD, 100 Mbit/s network.
2. **Install** — Download Monad binary; configure `node.toml` (RPC port, peer discovery, storage).
3. **Sync** — Start node; allow time to sync to network tip (check `eth_syncing`).
4. **Enable RPC** — Set `enable_client = true` in `node.toml`; expose RPC port (default 8545).
5. **Monitor** — Track block height, peer count, and disk usage; upgrade when announced.

## Common Gotchas

- **Gas limit charged, not usage** — Transactions pay `value + gas_price * gas_limit`, not actual gas used. Set gas limit conservatively to avoid overpaying.
- **No global mempool** — Transactions forwarded to next 3 leaders; may not appear in `eth_getTransactionByHash` immediately. Use RPC node's local mempool.
- **Pending transactions unavailable** — `eth_getTransactionByHash` returns `null` for unconfirmed txs. Poll after block is `Proposed`.
- **State availability limited** — `eth_call` with old block numbers may fail. Full nodes retain recent state only; use archive RPC for historical queries.
- **Storage pages, not slots** — First access to a 128-slot page pays cold cost; subsequent slots in page are warm. Contracts benefit automatically; no code changes needed.
- **Reserve balance constraints** — Delegated EOAs (EIP-7702) must maintain ≥10 MON balance; `CREATE`/`CREATE2` banned in delegated code.
- **Async execution reversion** — Transactions can revert at execution time (after consensus) if reserve balance insufficient. These are valid, included transactions.
- **Block tags map to states** — `latest` = `Proposed` (speculative), `safe` = `Voted`, `finalized` = `Finalized`. Use `finalized` for settlement.
- **Trace options required** — `debug_trace*` methods require explicit `{}` parameter; omitting causes `-32602 Invalid params` error.
- **EIP-4844 unsupported** — Blob transactions (type 3) rejected; use type 2 (EIP-1559) instead.

## Verification Checklist

Before submitting work:

- [ ] **Network correct** — Verified chain ID (143 mainnet, 10143 testnet) and RPC endpoint.
- [ ] **Gas limits set** — Per-transaction limit ≤30M, block limit ≤150M; gas charged on limit, not usage.
- [ ] **Storage optimized** — Checked if contract benefits from 128-slot pages; no changes needed for standard Solidity layouts.
- [ ] **Finality handled** — For settlement/bridges, wait for `Finalized` state (2 blocks, ~600ms); for UI, `Proposed` acceptable.
- [ ] **RPC limits respected** — `eth_getLogs` block range ≤100-1000 (provider-dependent); `eth_call` gas ≤200M.
- [ ] **Async execution understood** — Transactions speculatively executed; reversion possible at execution time; reserve balance checked.
- [ ] **Wallet integration tested** — MetaMask/Privy/other wallet connects; test transaction sends and receives.
- [ ] **Deployment verified** — Contract deployed, verified on block explorer, and tested on testnet before mainnet.
- [ ] **Error handling** — Trace options provided for debug calls; nonce gaps handled; pending tx queries avoided.

## Resources

**Comprehensive navigation:** https://docs.monad.xyz/llms.txt

**Critical pages:**
1. [Developer Essentials](https://docs.monad.xyz/developer-essentials) — Core reference for building on Monad.
2. [Deployment Summary](https://docs.monad.xyz/developer-essentials/summary) — Quick checklist and network facts.
3. [JSON-RPC Overview](https://docs.monad.xyz/reference/json-rpc/overview) — RPC methods, differences, limits, and error codes.

---

> For additional documentation and navigation, see: https://docs.monad.xyz/llms.txt