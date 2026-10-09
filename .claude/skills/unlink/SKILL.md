---
name: Unlink
description: Use when building private blockchain applications, integrating private payments, managing private DeFi interactions, or building private treasury operations. Reach for this skill when users need to send tokens privately, execute smart contracts from private balances, or manage private accounts on EVM chains.
metadata:
    mintlify-proj: unlink
    version: "1.0"
---

# Unlink Skill Reference

## Product summary

Unlink is a privacy-focused smart contract platform that lets you add private blockchain accounts to applications. The SDK (`@unlink-xyz/sdk`) runs on Node.js and browsers, signing transactions locally with EdDSA keys and generating zero-knowledge proofs to hide sender, recipient, and amount in private transfers. Unlink accounts are identified by `unlink1...` addresses (Bech32m format) and live inside a smart contract on EVM chains. The SDK works with viem, ethers, or custom wallet stacks. Key files: environment configuration (Base Sepolia, other chains), API key from dashboard.unlink.xyz, BIP-39 mnemonics for account derivation. Primary docs: https://docs.unlink.xyz

## When to use

Use Unlink when:
- Building private payment flows (payouts, grants, settlements) where sender/recipient/amount must be hidden
- Integrating private DeFi (swaps, lending, staking) from a private balance
- Managing private treasury operations or multi-user fund distribution
- Building AI agent wallets with scoped private funds
- Implementing private stablecoin or token applications
- Handling OTC trades or RFQ settlement privately
- Testing private transactions on testnet (Base Sepolia)

Do not use Unlink for public-only transactions, non-EVM chains, or when privacy is not required.

## Quick reference

### SDK imports and setup

| Use case | Import | Custody | Key lives |
|----------|--------|---------|-----------|
| Browser app | `@unlink-xyz/sdk/browser` | Non-custodial | Browser |
| Server/agent | `@unlink-xyz/sdk/client` | Custodial | Server |
| Backend auth | `@unlink-xyz/sdk/admin` | N/A | Server only |

### Core operations

| Operation | Method | Privacy | Gas paid by | Use when |
|-----------|--------|---------|-------------|----------|
| Deposit | `depositWithApproval()` | Amount/sender public | User | Moving tokens into private balance |
| Transfer | `transfer()` | All hidden | Unlink relayer | Sending privately between `unlink1` addresses |
| Withdraw | `withdraw()` | Sender hidden | Unlink relayer | Exiting private balance to public address |
| Execute | `execute()` | Sender hidden | Unlink paymaster | DeFi calls from private balance |

### Client creation

```ts
// Browser non-custodial
import { account, createUnlinkClient } from "@unlink-xyz/sdk/browser";
const { account: unlinkAccount } = await account.fromWallet({
  provider: window.ethereum,
  appId: "your-app-id",
  chainId: 84532,
});
const client = createUnlinkClient({
  environment: "base-sepolia",
  account: unlinkAccount,
});

// Server custodial
import { account, createUnlinkClient } from "@unlink-xyz/sdk/client";
const unlinkAccount = account.fromMnemonic({ mnemonic });
const client = createUnlinkClient({
  environment: "base-sepolia",
  account: unlinkAccount,
  register: (payload) => admin.users.register(payload),
  authorizationToken: {
    provider: () => admin.authorizationTokens.issue({ unlinkAddress }),
  },
});
```

### Account constructors

| Constructor | Source | Transfer | Withdraw | Execute |
|-------------|--------|----------|----------|---------|
| `fromMnemonic` | BIP-39 mnemonic | ✓ | ✓ | ✓ |
| `fromSeed` | 64-byte seed | ✓ | ✓ | ✓ |
| `fromEthereumSignature` | EOA signature | ✓ | ✓ | ✓ |
| `fromWallet` | Wallet signature | ✓ | ✓ | ✓ |
| `fromKeys` | Raw keys | ✓ | ✓ | ✗ |

Execute requires a seed-backed account. Use `fromMnemonic`, `fromSeed`, `fromEthereumSignature`, or `fromWallet`.

### Transaction status lifecycle

```
pending → relayed → confirmed → processed → (terminal)
                                         ↘ failed
```

- `pending`: preparing, proving, or waiting for on-chain hash
- `relayed`: submitted on-chain, effects not observed yet
- `confirmed`: receipt observed, visible to API reads (default wait target)
- `processed`: durable state persistence complete
- `failed`: terminal failure

## Decision guidance

### When to use execute() vs BurnerWallet

| Scenario | Use execute() | Use BurnerWallet |
|----------|---------------|------------------|
| Known call sequence | ✓ | |
| Tight private-balance integration | ✓ | |
| Outputs return to private balance | ✓ | |
| Protocol expects standard EOA | | ✓ |
| Higher-friction wallet integration | | ✓ |
| Disposable session wallet needed | | ✓ |

Start with `execute()` for DeFi. Use BurnerWallet when the protocol or frontend assumes a standard EOA session.

### When to use deposit vs faucet

| Scenario | Use deposit | Use faucet |
|----------|------------|-----------|
| Moving real tokens from user wallet | ✓ | |
| Funding test accounts | | ✓ |
| Onboarding/QA | | ✓ |
| Public ERC-20 mint to wallet | | ✓ (requestTestTokens) |
| Private transfer to account | | ✓ (requestPrivateTokens) |

### Browser vs server custody

| Factor | Browser | Server |
|--------|---------|--------|
| Spending key location | Browser | Server |
| API key visibility | Hidden (auth tokens only) | Server-side |
| Multi-user support | Per-user | Yes |
| Complexity | Lower | Higher |
| Key management | User responsibility | Your responsibility |

## Workflow

### 1. Set up the SDK

- Install: `npm install @unlink-xyz/sdk@canary`
- Create API key at dashboard.unlink.xyz
- Choose custody model (browser or server)
- Choose environment (e.g., `base-sepolia`)

### 2. Create a client

For browser:
```ts
const { account: unlinkAccount } = await account.fromWallet({
  provider: window.ethereum,
  appId: "your-app-id",
  chainId: 84532,
});
const client = createUnlinkClient({
  environment: "base-sepolia",
  account: unlinkAccount,
});
```

For server:
```ts
const unlinkAccount = account.fromMnemonic({ mnemonic });
const client = createUnlinkClient({
  environment: "base-sepolia",
  account: unlinkAccount,
  register: (payload) => admin.users.register(payload),
  authorizationToken: {
    provider: () => admin.authorizationTokens.issue({ unlinkAddress }),
  },
});
```

### 3. Register the account

```ts
await client.ensureRegistered();
```

Call once before the first mutating operation. Browser clients post to `/api/unlink/register` on your backend; server clients use the register callback.

### 4. Fund the account

Option A: Faucet (testnet only)
```ts
await client.faucet.requestPrivateTokens({ token: testTokenAddress });
const { balances } = await client.getBalances();
```

Option B: Deposit from EVM wallet
```ts
const tx = await client.depositWithApproval({
  token: tokenAddress,
  amount: "1000000000000000000",
});
await tx.wait();
```

### 5. Execute operations

Transfer privately:
```ts
const tx = await client.transfer({
  recipientAddress: "unlink1...",
  token: tokenAddress,
  amount: "500000000000000000",
});
await tx.wait({ until: "processed" });
```

Execute DeFi:
```ts
const result = await client.execute({
  withdrawFromPool: [{ token, amount }],
  calls: [approveCall, swapCall],
  returnToPool: [{ token: outputToken, amount: outputAmount }],
});
await result.wait();
```

Withdraw to public address:
```ts
const tx = await client.withdraw({
  recipientEvmAddress: "0x...",
  token: tokenAddress,
  amount: "500000000000000000",
});
await tx.wait();
```

### 6. Verify and monitor

```ts
const { balances } = await client.getBalances();
const { transactions } = await client.getTransactions({
  status: "processed",
  type: "transfer",
  limit: 20,
});
```

## Common gotchas

- **Spending key never leaves the client.** The SDK signs locally; only the signature goes to the Engine. Never log, serialize, or transmit the spending key.
- **Different mnemonics = different accounts.** The same mnemonic always derives the same `unlink1` address. A new mnemonic creates a new, empty account.
- **Deposit amount is public.** Deposits reveal the amount and source wallet. Plan timing and amounts to minimize linkability.
- **Execute requires seed-backed account.** `fromKeys` cannot execute. Use `fromMnemonic`, `fromSeed`, `fromEthereumSignature`, or `fromWallet`.
- **Wait for "processed" before spending outputs.** By default, `wait()` resolves at `confirmed`. For tight flows that immediately spend a transfer or deposit output, wait with `{ until: "processed" }`.
- **Faucet tx_id is not pollable.** Faucet returns a `tx_id` scoped to the faucet, not a transaction ID you can poll with `pollTransactionStatus()`. Use `getBalances()` to confirm arrival.
- **API key is server-only.** Never ship the admin API key in browser bundles. Browser clients use short-lived authorization tokens from your backend.
- **Authorization tokens expire.** Tokens rotate ~15 minutes. The SDK handles refresh automatically; no manual token management needed.
- **Permit2 approval is automatic.** `depositWithApproval()` handles approval if needed. Use `ensureErc20Approval()` only if you want manual control.
- **Execute is atomic.** Withdrawal, calls, and return-to-pool are one UserOperation. If any step reverts, the entire operation reverts and funds stay in the pool.
- **Viewing keys sent once at registration.** Viewing and nullifying keys cross to the Engine only during `register()`. After that, the Engine uses them to decrypt memos and track spendable notes.

## Verification checklist

Before submitting work with Unlink:

- [ ] Client is bound to the correct account (check `await client.getAddress()`)
- [ ] `ensureRegistered()` called before first mutating operation
- [ ] API key is server-side only (not in browser bundles)
- [ ] EVM provider is configured for deposits and execute operations
- [ ] Transaction wait target matches the flow (use `"processed"` for tight spending)
- [ ] Faucet tokens confirmed with `getBalances()`, not by polling faucet tx_id
- [ ] Execute account has seed-backed constructor (not `fromKeys`)
- [ ] Withdrawal/execute amounts are within note-field maximum (2^120−1)
- [ ] Backend auth routes (`/api/unlink/register`, `/api/unlink/authorization-token`) are mounted for browser clients
- [ ] Error handling covers `TimeoutError`, `ApiError`, `CapabilityError`, `ValidationError`

## Resources

- **Full page navigation:** https://docs.unlink.xyz/llms.txt
- **Quickstart:** https://docs.unlink.xyz/quickstart — install SDK, create client, make first transaction
- **How Unlink works:** https://docs.unlink.xyz/how-unlink-works — privacy model, what's public/private at each step
- **Custody models:** https://docs.unlink.xyz/custody-models — browser vs server integration patterns

---

> For additional documentation and navigation, see: https://docs.unlink.xyz/llms.txt