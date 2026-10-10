# Sigilo — Product & Technical Spec

> **The original proof of work.**
> Sigilo lets remote workers get paid in stablecoins privately, prove their income without revealing it, and borrow against their next paycheck, with no collateral.

| | |
|---|---|
| Status | v0.1 draft, 2026-10-07 |
| Event | Monad Metropolis hackathon |
| Primary track | **Track 02, Consumer Products & Payments** |
| Hard deadline | **2026-10-14 03:59 UTC** (Oct 13, 21:59 UTC-6). Target submission: Oct 13, 18:00 UTC-6 |
| Network | Monad testnet (chain ID `10143`) |
| Team | Solo |
| Production domain | **TBD.** Must be fixed before any passkey is created (passkeys bind to the rpId) |

---

## 1. Why this exists

### 1.1 Problem
1. **Stablecoin payroll is public payroll.** A worker paid in USDC/AUSD to a public address exposes their salary, their employer, and their pay dates to anyone who learns the address. In LatAm, that is also a physical security risk.
2. **Proving income means handing over everything.** Renting an apartment or getting a loan requires contracts, bank statements, and the exact salary. Incumbents like Equifax's *The Work Number* sell employment and income verifications to lenders, using employer-supplied data the worker doesn't control.
3. **Remote workers paid from abroad are invisible to local credit.** Foreign income in stablecoins doesn't fit local bank underwriting, so credit is expensive or requires collateral.

### 1.2 Insight
In LatAm, the cheapest consumer credit is **payroll-deducted credit** (Brazil: *crédito consignado*; Colombia: *libranza*; Central America: *deducción de planilla*; Mexico: *préstamo de nómina*). It's cheap because the installment is deducted **before the salary reaches the worker**, so repayment is enforced at the source.

Whoever runs the payroll rail can offer payroll deduction. Sigilo runs a **private** payroll rail. That gives three layers that compound:

1. **Private payroll (the wedge).** It generates verifiable income data and controls where the money flows.
2. **Private income passport (the network).** Workers prove income predicates in zero knowledge.
3. **Paid verifications + payroll-deducted advances (the revenue).** Lenders pay per verification via MPP, and advances are repaid automatically from the next payroll run.

### 1.3 Positioning
Private payroll *alone* is a crowded idea: Request Finance × Aleo, Cloak (Solana), and several ETHGlobal projects already do it. **Do not lead the pitch with "private payroll."** Lead with: *"your paycheck works as proof and as credit, without anyone seeing it."* Private payroll is the foundation, not the headline.

---

## 2. Users

| Persona | Who | Wants |
|---|---|---|
| **María, worker (primary)** | Frontend dev in San José, Costa Rica, paid monthly in digital dollars by a US startup | Get paid without exposing her salary; prove income to rent or borrow; send money to family |
| **Acme Labs, employer** | US startup with 8 contractors in LatAm | Pay globally in one click, keep the team's compensation confidential, reduce payroll ops |
| **Fondo Quincena, lender** | Small lender or cooperative offering salary advances | Verify income cheaply and reliably; get repaid with low default risk |

Judging rubric reminder (Track 02): Technical Execution 20%, **Design & Craft 20% ("judge harshly on any friction that reveals 'this is crypto'")**, Originality 15%, **Founder & Market Readiness 25%** (named segment, real pain), **Traction 20%** (at least 5 real testers, distribution plan for the next 100 users).

---

## 3. Product overview

### 3.1 Surfaces
| Surface | Route | Device | Custody |
|---|---|---|---|
| Worker app (PWA) | `/app` | Mobile-first, installable | **Non-custodial.** Every key derives from the worker's passkey (Mera) |
| Employer dashboard | `/employer` | Desktop | **Custodial treasury.** A server-held Unlink account, Deel-style |
| Lender console | `/lender` | Desktop | Demo lender key held server-side |
| Public verification page | `/v/[requestId]` | Any | — |
| Landing | `/` | Any | — |

### 3.2 Feature list and priority
**P0 = must ship. P1 = should ship. P2 = only if time allows.** Cut from the bottom.

**Worker app**
| Pri | Feature |
|---|---|
| P0 | One-tap onboarding with Face ID or Touch ID (Mera passkey). No seed phrase, no extension, no email/OTP |
| P0 | Accept an employer invite (link) and bind the payroll profile |
| P0 | Private balance ("digital dollars") and pay history |
| P0 | Encrypted payslips that only the worker can open |
| P0 | Income Passport: answer a lender's verification request with a ZK proof ("≥ $X/month for the last N months, verified employer") |
| P0 | New-device recovery: same passkey on a fresh browser restores balance, payslips, and passport (the "stateless test") |
| P1 | Request a salary advance from a lender who verified the passport. Sign a payroll-deduction mandate |
| P1 | "Send home": send AUSD to family or across borders with Agora Instant Settlement (AUSD to local-currency stable, mocked with CTK) |
| P2 | Share a scoped payslip view with an accountant (re-encrypt selected payslips to their key) |
| P2 | Private yield on idle balance (Unlink `execute` into a lending market) |
| P2 | Daily pay drips ("get paid every day you work") |

**Employer dashboard**
| Pri | Feature |
|---|---|
| P0 | Treasury: fund with test tokens (faucet), view private treasury balance |
| P0 | Add employees: name, monthly salary, currency, then generate an invite link |
| P0 | Run payroll: one private multi-recipient transfer + encrypted payslips + payroll-run commitment |
| P1 | Apply payroll deductions automatically for active advance mandates |
| P1 | Salaries denominated in local currency (CRC/COP/MXN) and converted at the run's FX rate |
| P2 | Scheduled payroll via a Chainlink CRE workflow |

**Lender console**
| Pri | Feature |
|---|---|
| P0 | Create a verification request ("income ≥ $1,500, 3 months") and show it as a QR or link |
| P0 | Receive the proof, pay the verification fee through **MPP**, and see the verified result |
| P1 | Offer and fund an advance from the AdvanceVault, and track repayments arriving from payroll |
| P2 | Portfolio dashboard powered by an Envio indexer |

---

## 4. Core user flows

### F1. Worker onboarding (P0)
1. María opens the invite link from Acme (`/app/invite/[code]`).
2. Taps **"Continue with Face ID"**, which calls Mera `createPasskeyWithPrfOutput` with salt `S_ACCOUNT`. That's one prompt.
3. Client derives (see §6) the EVM key, the Unlink seed, and the payslip keypair. It opens a Mera signing session (prompt-free for the rest of the session).
4. Client registers the Unlink account (`client.ensureRegistered()`).
5. Client sends to the backend: Unlink address, payslip public key, and the EVM address (for sessions and mandates). The backend binds them to the employee record.
6. A step-up prompt with salt `S_PASSPORT` derives `passportSecret`. The client sends `C = H(passportSecret)` (passport commitment) to the employer record. This can be deferred to "Activate passport".
7. Testnet only: the backend drips a little MON to the EVM address so public actions work without "get gas" steps.

### F2. Employer setup (P0)
1. The demo employer "Acme Labs" is pre-seeded and marked **verified** (KYB stand-in) in `SigiloRegistry`.
2. The employer funds the treasury: faucet → Unlink deposit (or `requestPrivateTokens` directly).
3. The employer adds employees and shares the invite links.

### F3. Payroll run (P0)
1. The employer clicks **Run payroll** for period `P` (e.g. `202610`).
2. The backend computes net pay per employee (salary − active deduction installments).
3. **Private payout:** one Unlink multi-recipient transfer from the treasury account:
   `client.transfer({ token, transfers: [{ recipientAddress, amount }, ...] })`
4. **Payroll commitment:** for each employee *i*, the backend builds the leaf
   `leaf_i = H(C_i, employerId, P, amount_i, salt_i)` (gross amount, random `salt_i`). It then builds the run tree, gets `runRoot`, and appends `regLeaf = H(employerId, P, runRoot)` to the global registry tree. It publishes the new `registryRoot` on-chain (`SigiloRegistry.publishRoot`).
5. **Payslips:** for each employee, the backend encrypts `{period, gross, deductions, net, employerName, leaf preimage, run Merkle path, runRoot}` to the employee's payslip public key and stores the ciphertext.
6. **Deductions (P1):** for each active mandate, the installment goes to the AdvanceVault through Unlink `execute` calling `AdvanceVault.repay(advanceId, amount)`. The fallback is an operator EOA.

### F4. Worker sees pay (P0)
Balance (`client.getBalances()`), history (`client.getTransactions()`), and payslips decrypted client-side. Copy: *"You got paid · $2,400 · Oct 2026"*. Never "transaction", "token", or "wallet".

### F5. Income Passport: verification request (P0)
1. The lender creates a request in `/lender`: `{ threshold: 1500, months: 3, scope }`. It's shown as a QR or link to `/v/[requestId]`.
2. María opens it on her phone. The screen reads *"Fondo Quincena wants to confirm you earn at least $1,500/month for the last 3 months. They won't see your employer or your exact salary."*
3. She taps **Share proof**: a step-up prompt (`S_PASSPORT`), then the client fetches registry leaves (§7.3), builds the paths, and generates the Noir proof in the browser.
4. The proof and public inputs are posted to the request.

### F6. Lender verifies via MPP (P0)
1. The lender console calls `POST /api/v1/verify` (the Sigilo Verify API), which is gated by `mppx.charge()`.
2. On `402`, the lender's MPP client pays (≈ $0.10, pull mode / ERC-3009) and retries.
3. The API verifies the proof (bb.js), checks that `registryRoot` is known on-chain, and returns a Sigilo-signed result: `{ valid, threshold, months, pseudonym, registryRoot, verifiedAt }`.
4. The lender UI shows *"Verified · $0.10 paid"* with the payment receipt.
5. Alternative path: verify on-chain for free through `IncomePassportVerifier`. The paid API is the convenience/attestation product (no proving stack, signed receipt, freshness, and employer-KYB guarantees).

### F7. Salary advance with payroll deduction (P1)
1. After verification, the lender offers *"Up to $450 now, repaid from your next 2 paychecks, 2% fee."*
2. María accepts. The client calls `AdvanceVault.requestAdvance(proof, publicInputs, amount, recipient)`. The proof's `scope` must equal the vault's scope, and there's one active advance per `pseudonym`.
3. María signs an EIP-712 **DeductionMandate** `{ advanceId, installment, installments, vault }` with her Mera EVM key. The backend delivers it to the employer's payroll engine.
4. On the next payroll run (F3.6), the installment is deducted and repaid automatically. The lender sees it arrive.

### F8. Send home with Agora (P1, required for the Agora bounty)
1. María taps **Send home** and enters $200 for her mom.
2. Unlink `withdraw` moves the funds to her own EVM address (public step: it shows the amount and destination, not the source).
3. Instant Settlement swap AUSD → CTK (stand-in for a local-currency stable) at a fixed price, then a transfer to the recipient.
4. UI: *"Delivered in 0.8s."* The bounty video must show passkey onboarding, an AUSD balance, and a completed send/receive.

### F9. Stateless / new-device test (P0, required for both Mera bounties)
A judge clears local storage or opens the app on a second device, signs in with the same passkey, and gets the same EVM address, the same Unlink account and balance, the same decrypted payslips, and the same passport pseudonyms. Nothing secret is persisted anywhere.

---

## 5. Privacy model

| Data | Visible to |
|---|---|
| Individual salary | Worker, employer (and Sigilo as payroll operator) |
| Who works for whom | Worker, employer, Sigilo. **Not on-chain** |
| Employer treasury deposit (amount, source) | **Public** (Unlink deposits are public) |
| Payroll transfers (sender, recipients, amounts) | **Private** (Unlink ZK transfer) |
| `registryRoot` | Public, but reveals nothing on its own |
| Income predicate ("≥ $X for N months, verified employer") | Only the verifier the worker chose |
| Worker identity across lenders | **Unlinkable.** A different `pseudonym` per verifier scope |
| Withdrawals / Send home | Public amount and destination; the source private account stays hidden |
| Advance disbursement | Public (vault → worker EVM address) |
| An active advance | Worker, lender, employer (needs it to deduct; same as real-world payroll deduction) |

**Known trust assumptions (hackathon scope):** Sigilo operates the registry root (a trusted operator, documented). Employers are trusted to commit correct gross amounts (they're the issuer). Employer KYB is simulated. Unlink Engine trust boundaries apply (see Unlink trust model).

---

## 6. Key management (Mera)

One passkey, many keys. The PRF output depends on (credential, rpId, salt), and **each salt is an isolated namespace**. Each ceremony = one user-verification prompt.

| PRF salt (32 bytes) | When prompted | Derived (HKDF-SHA256, `info` label) | Used for |
|---|---|---|---|
| `S_ACCOUNT = sha256("sigilo/account/v1")` | Sign-in (one prompt) | `info="evm"` → secp256k1 key | Mera signing session, viem account (`toViemAccount`), mandates, Send home |
| | | `info="unlink"` → 64-byte seed | `account.fromSeed(seed)` → Unlink account (non-custodial) |
| | | `info="payslips"` → X25519 keypair | Decrypt payslips (employer encrypts to the public key) |
| `S_PASSPORT = sha256("sigilo/passport/v1")` | **Step-up** when sharing a proof | `passportSecret` (field element) | Passport commitment `C = H(passportSecret)`; per-verifier `pseudonym = H(passportSecret, scope)` computed in-circuit |

Rules:
- **Pick the production domain before creating any passkeys.** Passkeys are bound to the rpId, so changing domains orphans every account.
- Nothing secret goes to localStorage or the server. Session keys live only in memory (Mera session `end()` on logout or expiry).
- Session design (Mera UX criterion): prompt-free for viewing and low-risk signing within a session; re-prompt (step-up) for sharing a passport and for accepting an advance.

---

## 7. Payroll commitments and registry

### 7.1 Hash
Poseidon2 over the BN254 scalar field. **Use the same implementation in TypeScript and Noir, and pin cross-language test vectors in CI** (this is the #1 source of "proof fails" bugs).

### 7.2 Trees
- **Run tree** (per employer per period): leaves `leaf_i = H(C_i, employerId, period, gross_i, salt_i)`, depth `D_RUN = 8` (256 employees).
- **Registry tree** (global, append-only): leaves `regLeaf = H(employerId, period, runRoot)`, only for **verified** employers, depth `D_REG = 16`.
- `registryRoot` is published on-chain after every run. The contract keeps a history of the last 64 roots.

### 7.3 Path privacy
Workers must not reveal which run they're proving to the backend. `GET /api/registry/leaves` returns **all** registry leaves (small), and the client rebuilds the tree and computes its own path. The run-tree path comes inside the encrypted payslip.

---

## 8. ZK circuit: `income_passport` (Noir)

**Statement:** "I know a passport secret whose commitment appears in the payroll runs of the same verified employer for `N` consecutive periods, with gross pay ≥ `T` in each, and this is my pseudonym for scope `S`."

- `N = 3` (fixed at compile time; the demo uses back-filled periods).
- **Public inputs:** `registry_root`, `periods[N]`, `threshold`, `scope`, `nonce`, `pseudonym`
- **Private inputs:** `passport_secret`, `employer_id`, and for each k: `gross[k]`, `salt[k]`, `run_root[k]`, `run_path[k][D_RUN]`, `run_index[k]`, `reg_path[k][D_REG]`, `reg_index[k]`

**Constraints:**
```
C = H(passport_secret)
for k in 0..N:
  leaf      = H(C, employer_id, periods[k], gross[k], salt[k])
  assert merkle_root(leaf, run_path[k], run_index[k]) == run_root[k]
  reg_leaf  = H(employer_id, periods[k], run_root[k])
  assert merkle_root(reg_leaf, reg_path[k], reg_index[k]) == registry_root
  assert gross[k] as u64 >= threshold as u64
  assert periods[k] == periods[0] + k          // consecutive months (encode as month index)
assert pseudonym == H(passport_secret, scope)
// constrain nonce (bind to proof; e.g. include in an output hash) to prevent replay
```

Cost estimate: N × (D_RUN + D_REG + 2) ≈ 78 Poseidon2 hashes. That should prove in seconds in a mobile browser (UltraHonk via `@aztec/bb.js` + `@noir-lang/noir_js`). **Measure on a real phone during the spike.**

**Verifier:** generate the Solidity verifier with `bb` (UltraHonk, keccak oracle for EVM). Wrap it in `IncomePassportVerifier`. Mirror verification off-chain in the Verify API with bb.js.

**Scope:** `scope = uint256(keccak256(abi.encode(verifierAddressOrId, chainId))) mod p`. The AdvanceVault only accepts proofs whose scope is its own.

---

## 9. Smart contracts (Foundry, Monad testnet)

| Contract | Responsibility |
|---|---|
| `SigiloRegistry` | Operator-managed. `setEmployerVerified(employerId, bool)`, `publishRoot(bytes32 root)`, root history (ring buffer of 64), `isKnownRoot(root)` |
| `HonkVerifier` | Generated by `bb` from the circuit |
| `IncomePassportVerifier` | `verify(proof, publicInputs) view` checks `isKnownRoot` and delegates to `HonkVerifier`. `attest(...)` emits `PassportVerified(scope, pseudonym, threshold, periodsHash)` |
| `AdvanceVault` | Lender liquidity in AUSD (or test token). `requestAdvance(proof, publicInputs, amount, recipient)`: scope == vault scope, one active advance per pseudonym, `amount ≤ maxRatio × threshold`. `repay(advanceId, amount)`. Events: `AdvanceIssued`, `AdvanceRepaid`, `AdvanceClosed` |
| *(fallback)* `MockUSD` | ERC-20 + ERC-3009, only if AUSD can't be used with Unlink or MPP on testnet |

---

## 10. Backend API (Next.js route handlers)

| Route | Purpose |
|---|---|
| `POST /api/unlink/register`, `POST /api/unlink/authorization-token` | Unlink auth routes (`createUnlinkAuthRoutes` from `@unlink-xyz/sdk/admin`). Requires `UNLINK_API_KEY` |
| `POST /api/session` | Worker signs a challenge with their Mera EVM key → session cookie (auth only, no custody) |
| `GET /api/invite/[code]`, `POST /api/invite/[code]/accept` | Bind worker keys (Unlink address, payslip pubkey, EVM address, passport commitment) to the employee |
| `POST /api/employer/employees`, `GET /api/employer/employees` | Manage employees |
| `POST /api/employer/runs`, `GET /api/employer/runs` | Execute payroll run (F3), list runs |
| `GET /api/me/payslips` | Encrypted payslips for the session's worker |
| `GET /api/registry/leaves` | All registry leaves (for client-side path building) |
| `POST /api/requests`, `GET /api/requests/[id]`, `POST /api/requests/[id]/proof` | Verification requests (F5) |
| `POST /api/v1/verify` | **MPP-gated** (`mppx.charge()`) Sigilo Verify API (F6) |
| `POST /api/mandates` | Store signed deduction mandates (F7) |
| `POST /api/gas/drip` | Testnet only: small MON drip to new worker EVM addresses |
| `POST /api/cre/payroll-due` | P2: called by the CRE workflow (signed) |

**Storage:** Postgres (Neon or Supabase) + Drizzle. Tables: `employers`, `employees`, `invites`, `payroll_runs`, `payslips` (ciphertext only), `registry_leaves`, `verification_requests`, `verifications`, `mandates`, `advances` (cache of on-chain state).

---

## 11. Integrations

### Mera (`@category-labs/mera`)
- `createPasskeyWithPrfOutput({ rp, user, prfSalt })` for sign-up. `getPasskeyPrfOutput({ rpId, prfSalt })` for sign-in and step-up (one prompt each).
- `createSecp256k1SigningSession({ privateKey })`, then `toViemAccount(session)` from `@category-labs/mera/viem`. Call `session.end()` on logout or expiry.
- HTTPS or localhost only. PRF works with iCloud Keychain and 1Password (check the authenticator support page for Android/Chrome).
- Docs: https://mera.category.xyz

### Unlink (`@unlink-xyz/sdk@canary`)
- Environment `monad-testnet` (chain `10143`). Mainnet requires an access grant, so **the hackathon runs on testnet**.
- API key from https://dashboard.unlink.xyz (project for Monad testnet). Backend-only.
- Worker: `@unlink-xyz/sdk/browser`, `account.fromSeed(seed64)`, `createUnlinkClient({ environment, account })`.
- Employer treasury: `@unlink-xyz/sdk/client` (custodial) + `@unlink-xyz/sdk/admin`.
- Calls: `ensureRegistered`, `depositWithApproval`, `transfer` (multi-recipient), `withdraw`, `execute` (needs a seed-backed account), `getBalances`, `getTransactions`, `faucet.requestTestTokens` / `faucet.requestPrivateTokens`.
- Wait on `tx.wait({ until: "processed" })` before spending fresh funds.
- Groth16 proving runs **on the Engine**; the client only signs. Mobile proving time is not a concern for Unlink.
- The SDK has no memo or viewing-key disclosure API, so we keep our own encrypted payslip channel. `createUnlinkAuthRoutes` uses Web `Request`/`Response` and drops into Next route handlers.
- **2026-10-09: the `monad-testnet` Engine host does not resolve** (`monad-testnet-production-api.unlink.xyz` → a fly.dev name with no DNS record). Check `curl https://monad-testnet-production-api.unlink.xyz/health` before relying on it. `createUnlinkClient` accepts `engineUrl` if Unlink gives us a new one.
- Docs: https://docs.unlink.xyz (`/llms.txt`)

### MPP (`@monad-crypto/mpp` + `mppx` + `viem`)
- Server: `Mppx.create({ methods: [monad({ account, recipient, currency: AUSD, decimals: 6, testnet: true })], secretKey })` from `mppx/nextjs`, then `export const POST = mppx.charge({ amount: "0.10", description })(handler)`. `amount` is human-readable; `currency`/`recipient` can be overridden per route.
  - There is **no default testnet currency**: without `currency`, `testnet: true` throws. `secretKey` (≥ 32 bytes) is required. Create `Mppx` lazily so `next build` doesn't need the secret.
- Client (lender): `Mppx.create({ methods: [monad({ account, mode: "pull" })], polyfill: false })` then `mppx.fetch(...)`. In pull mode (ERC-3009) the client needs only AUSD, and the server `account` pays MON gas.
  - Pull mode only signs for a hardcoded `erc3009Tokens` list (mainnet USDC/USDT0). Add testnet AUSD with `pnpm patch @monad-crypto/mpp`: `"0xa9012a055bd4e0edff8ce09f960291c09d5322dc": { name: "Agora Dollar", version: "1" }`. Fallback: client `mode: "push"` (needs MON + AUSD).
  - `@monad-crypto/mpp@0.0.3` was built against mppx 0.4.8; mppx 0.13.4 exports what it imports but the pair is untested. Replay protection is an in-memory store by default; pass a shared `store` on serverless.
- Only the `charge` intent exists on Monad today.
- Docs: https://docs.monad.xyz/reference/mpp/overview

### Agora (AUSD + Instant Settlement), Monad testnet
- Instant Settlement Factory `0x8468587Af422ad440F58a57E955eCA6A970b5375`
- CTK / AUSD Pair `0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae`
- Whitelister `0x7c10F56d6f04a51376393a1C3670e966863F6BD5`. Swaps require an approved swapper; `setApprovedSwapper(address)` is self-service on testnet and can whitelist any address.
- AUSD (testnet) `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, 6 decimals (pair token1). Faucet `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`: `requestFunds(address)`.
- CTK (testnet) `0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D`, 18 decimals (pair token0). No faucet on Monad; get it by swapping.
- Swap (all calls on the **pair**): `hasRole("APPROVED_SWAPPER", me)` → `getAmountsOut(amountIn, [AUSD, CTK])` → `approve(pair, amountIn)` → `swapExactTokensForTokens(amountIn, amountOutMin, path, to, deadline)`. On 2026-10-09: price 1:1, zero fees, ~1M of each token in liquidity.
- Examples: https://github.com/agora-finance/stable-swap-examples/tree/monad/src
- Testnet tokens + whitelisting: https://docs.agora.finance/instant-settlement/guides/getting-testnet-tokens.md
- AUSD on Monad mainnet: `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`
- AUSD supports ERC-3009 (and `permit`), so it's compatible with MPP pull mode. Its EIP-712 domain name is `"Agora Dollar"`, version `"1"`, although `name()` returns `"AUSD"`.
- All addresses above were verified on-chain with `cast call` on 2026-10-09.
- Docs: https://docs.agora.finance

### Noir
- Circuit in `packages/circuits/income_passport`. Use `nargo` to compile/test and `bb` for the verification key and Solidity verifier.
- Browser proving: `@noir-lang/noir_js` + `@aztec/bb.js` (UltraHonk). Pin versions that match `nargo`/`bb` exactly.

### Chainlink CRE (P2, bounty: $3k)
- Workflow "Payroll scheduler":
  1. Cron trigger.
  2. HTTP fetch of `/api/cre/payroll-due` and an FX rate API (local-currency salaries).
  3. Call the run endpoint and/or write a report on-chain.
- A **CLI simulation** is enough for the bounty. CRE supports Monad testnet for simulation (forwarder addresses in the CRE docs).

### Envio (P2, bounty: $1k)
- HyperIndex over `SigiloRegistry`, `IncomePassportVerifier`, and `AdvanceVault`.
- Derived entities: lender portfolio (outstanding, repaid, default rate), network stats (verified employers, runs, verifications).

---

## 12. Repository layout

```
Sigilo/
├── apps/
│   └── web/                 # Next.js (App Router) PWA: /, /app, /employer, /lender, /v/[id], /api/*
├── packages/
│   ├── core/                # Shared TS: key derivation, Poseidon2 + trees, payslip crypto, types, constants
│   ├── contracts/           # Foundry: SigiloRegistry, IncomePassportVerifier, HonkVerifier, AdvanceVault
│   ├── circuits/            # Noir: income_passport (+ test vectors shared with core)
│   ├── cre/                 # P2: CRE payroll workflow
│   └── indexer/             # P2: Envio HyperIndex
├── SPEC.md
└── README.md
```

Stack: pnpm workspaces, TypeScript, Next.js + Tailwind + shadcn/ui, viem, Drizzle + Postgres, Foundry, Noir. Deploy the web app to Vercel on the **final domain** (passkey rpId).

---

## 13. UX and copy rules

The Track 02 bar is an **invisible blockchain**.

- **Never use:** wallet, gas, token, transaction, chain, Monad, Unlink, ZK, proof, hash, address, seed.
- **Use instead:** account, digital dollars (USD), payment, payslip, Income Passport, "verified", "private".
- One primary action per screen. Show amounts in USD with local-currency equivalents.
- Every wait state has human copy: *"Securing your payment…"*, *"Preparing your passport…"* (proof generation), never spinners alone.
- The Agora bounty requires showing an **AUSD** balance. Show *"Digital dollars (AUSD)"* in the account details, not in the headline.
- **Privacy you can see:** after a payroll run, a split screen shows "What María sees" vs. "What the internet sees" (the block explorer with nothing linkable). This is the demo's signature moment.

---

## 14. Demo script (3:00)

| Time | Beat |
|---|---|
| 0:00 | Hook: *"Stablecoins put your salary on a block explorer. Anyone with your address knows what you earn."* (show a real explorer) |
| 0:15 | María taps the invite, Face ID, done. (~5 s) |
| 0:30 | Acme runs payroll for 3 employees in one click. Split screen: María sees $2,400; the explorer shows nothing linkable |
| 1:00 | María opens her payslip (decrypted on device) |
| 1:15 | Fondo Quincena (laptop) shows a QR: "income ≥ $1,500, 3 months". María scans, Face ID, passport shared |
| 1:45 | Lender verifies: *"Verified · $0.10 paid via MPP"*. Sees no employer, no salary |
| 2:00 | Lender offers a $450 advance; María accepts. Next payroll run deducts the installment automatically |
| 2:30 | María sends $200 home (Agora, instant) |
| 2:45 | Stateless test: fresh browser, same passkey, everything is back |
| 2:55 | Close: *"Sigilo. The original proof of work."* |

---

## 15. Plan

### 15.1 Spikes (tonight, go/no-go)
| # | Spike | Go criterion | Fallback |
|---|---|---|---|
| S1 | Mera PRF on target devices (iPhone Safari, desktop Chrome + iCloud/1Password) on the **deployed domain** | Same 32 bytes across devices | Desktop-only demo + phone via iCloud sync |
| S2 | Unlink on `monad-testnet`: API key, `fromSeed(HKDF(PRF))`, register, faucet, multi-recipient transfer, balance read; **measure proving time on a phone** | Transfer confirmed; acceptable latency | Worker proving via custodial client (drops the "no custody backend" claim) |
| S3 | Can Unlink `monad-testnet` hold **AUSD** (or only its mock tokens)? | AUSD deposit works | Payroll in Unlink's mock token shown as "USD"; AUSD only in Send home |
| S4 | Agora testnet: whitelist via Whitelister, obtain AUSD, swap AUSD↔CTK | Swap succeeds | Agora bounty dropped; Send home becomes a plain transfer |
| S5 | MPP on testnet: which token does `monad()` charge, and is it configurable (AUSD/USDC)? | Paid request round-trips | MockUSD with ERC-3009 |
| S6 | Noir: compile toy circuit → browser proof → Solidity verifier deployed on Monad testnet → `verify` passes | End-to-end in < 2 h | Off-chain verification only (Verify API) |
| S7 | ~~Ask the organizers whether a PWA counts as a "mobile application" for the Agora bounty~~ | **Resolved: yes** (confirmed on the hackathon Discord, 2026-10-08) | — |

**Results (2026-10-09):**
- **S1:** open. Blocked on the production domain.
- **S2:** **at risk.** The `monad-testnet` Engine host doesn't resolve (see §11 Unlink). Phone proving is a non-issue: Unlink proves on the Engine.
- **S3:** open. The API is confirmed; whether the pool accepts AUSD can only be tested against a live Engine.
- **S4:** **go.** Whitelisting is self-service, and the AUSD faucet and swap are verified with read-only calls (§11 Agora).
- **S5:** **partial go.** Pass `currency` = testnet AUSD. Pull mode needs a one-line `pnpm patch` (§11 MPP); push mode is the fallback.
- **S6:** **go** off-chain and in Foundry. A TS witness → noir_js → bb.js proof (226 ms native) verifies in `HonkVerifier` (~5.4M gas). What remains: deploy to testnet and measure browser proving on a phone.

### 15.2 Phases (cut lines are in order)
| When | Phase | Output |
|---|---|---|
| Oct 7 (night) | 0. Scaffold + spikes | Monorepo, deploy on the final domain, S1–S6 answered |
| Oct 8 | 1. Accounts + payroll | Mera onboarding, worker Unlink account, employer treasury, payroll run, balance/history |
| Oct 9 | 2. Commitments + circuit | Payslip encryption, trees, `SigiloRegistry`, Noir circuit, browser proving |
| Oct 10 | 3. Verification | Verification requests, `IncomePassportVerifier`, MPP-gated Verify API, lender console |
| Oct 11 | 4. Credit + cross-border | `AdvanceVault`, mandates, deductions in payroll, Send home (Agora) |
| Oct 12 | 5. Polish + traction | UX pass, 5 real testers (record feedback), stateless test, CRE simulation, Envio (if time) |
| Oct 13 | 6. Ship | Videos, README, bounty forms, **submit by 18:00 UTC-6** |

---

## 16. Submission checklist

**Main track (all required):**
- [ ] Logo (JPG/PNG/WEBP, ≤ 3 MB)
- [ ] Public GitHub repo, accessible by `metropolis@hackathon.monad.xyz`
- [ ] Technical demo video ≤ 3 min. Live product only, no slides or code walkthrough
- [ ] Pitch video ≤ 2 min: team, problem, why us
- [ ] Live link on Monad testnet + access instructions + test credentials for judges
- [ ] (Optional) 30 s promo clip

**Bounty fields:**
- [ ] **Agora:** text on the core send-AUSD features + demo video ≤ 2 min (passkey onboarding, AUSD balance, completed send/receive)
- [ ] **Mera UX:** text on how Mera is the entire account layer (+ optional video ≤ 2 min)
- [ ] **Mera Many Keys:** text on non-account PRF namespaces (+ optional video ≤ 2 min). Show the cross-device test live
- [ ] **Chainlink CRE (P2):** text + video ≤ 2 min of the CLI simulation or a live deployment
- [ ] **Envio (P2):** text (+ optional video ≤ 2 min); repo must include `config.yaml`, `schema.graphql`, handlers

**Traction evidence:**
- [ ] 5+ testers (names/roles, quotes, what broke)
- [ ] Distribution plan for the next 100 users (LatAm remote-dev communities, employers of record, cooperatives)

---

## 17. Risks and open questions

| Risk | Mitigation |
|---|---|
| Unlink proving or performance in mobile Safari | Measure in S2; fall back to desktop for the employer, keep worker flows light |
| Unlink testnet token ≠ AUSD | S3 fallback; be explicit in the README |
| Passkey PRF support varies (Android/Chrome) | Demo on iPhone + Mac with iCloud Keychain; document support |
| Poseidon2 mismatch between TS and Noir | Shared test vectors from day 1 |
| Agora whitelist on testnet | S4; Agora is P1, not P0 |
| Proof replay | `nonce` bound into the proof; requests are single-use |
| Scope creep (solo, 6 days) | Strict P0/P1/P2; cut P2 first, then the advance (keep it as a pitch slide) |
| Domain change breaks passkeys | Lock the domain in Phase 0 |

**Open questions** (answered 2026-10-09):
- ~~Does Unlink's SDK expose any memo or viewing-key feature that could replace our own payslip channel?~~ No. "Scoped audit views" exists only in marketing. Keep our own payslip channel.
- ~~`@monad-crypto/mpp`: how to set the amount and token per route in `mppx.charge()`?~~ `mppx.charge({ amount, currency?, recipient? })`, see §11 MPP.
- **New:** is the Unlink `monad-testnet` Engine up, and does its pool accept testnet AUSD? (§11 Unlink, S2/S3)

---

## 18. Beyond the hackathon

- **Business model:** an employer SaaS fee per worker per month (Deel-like); per-verification fees paid via MPP (The Work Number-like, but user-owned); origination and spread on payroll-deducted advances (*crédito consignado*-like).
- **Roadmap:**
  1. Employer-of-record partners in LatAm.
  2. More verifiers: landlords, visa and immigration, gig platforms.
  3. Proofs over other income sources (zkTLS on bank or Deel statements).
  4. Agents as payees: budgets for AI agents paid through MPP, under the same private ledger.
  5. Monad mainnet with Unlink access grant.
