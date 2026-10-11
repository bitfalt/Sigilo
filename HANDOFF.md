# Handoff — 2026-10-10 (morning)

Start a new session with: _"Read SPEC.md, AGENTS.md and HANDOFF.md, then continue with the next steps."_

Deadline: **2026-10-14 03:59 UTC** (Oct 13, 21:59 CST). Target submit Oct 13 18:00 CST.

## Live

- **sigilo.work** on Vercel (Root `apps/web`, build `npx convex deploy --cmd 'pnpm run build'`). Prod Convex `bold-marlin-213`, dev `brazen-poodle-85`.
- Pages: `/` (landing), `/record/[tx]` (what the internet sees for a payroll), `/app` (worker), `/app/invite/[code]`, `/app/send`, `/app/receive`, `/app/settings`, `/employer`, `/lender`, `/v/[requestId]` (income check + advance offer), `/api/v1/verify` (MPP-paid), `/api/lender/verify`.
- Contracts on Monad testnet, verified: `packages/core/src/deployments.ts`. `AdvanceVault` `0xdB38A7F37f45934A42f4ddD740d8F69414de7734` (lender = LENDER, 30% cap, 2% fee, funded with 1,000 AUSD). Each `requestAdvance` costs the operator ~0.6 MON (5.8M gas proof check).

## What works end to end (testnet)

| Flow                                                                                                                                                                                               | Proof it works                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Payroll in fixed pieces to one-time accounts, blind server                                                                                                                                         | `pnpm smoke:payroll` 13/13                                            |
| Passkey create/sign-in (prod)                                                                                                                                                                      | `pnpm e2e:passkey https://sigilo.work` 10/10                          |
| Income Passport: request → browser proof (≈6.4 s headless) → free on-chain check → lender pays $0.10 via MPP → signed attestation                                                                  | `pnpm smoke:passport` 16/16, `pnpm e2e:passport` 19/19 (real UI)      |
| Send home: pieces sign ERC-3009 → unauthenticated relay → `SigiloPay.sendHome` (AUSD→CTK on Agora) → Mom's receipt                                                                                 | `pnpm smoke:sendhome`, `pnpm e2e:sendhome` 14/14 (delivered in 0.7 s) |
| Salary advance: lender offer → worker proves for the AdvanceVault (nonce binds her fresh account) → relayed `requestAdvance` → EIP-712 deduction mandate → payroll deducts and repays until closed | `pnpm smoke:advance` 11/11, `pnpm e2e:advance` 20/20                  |
| Advanced settings (step-up): move everything out (`SigiloPay.collect`), export keys JSON                                                                                                           | `pnpm smoke:collect`, `pnpm e2e:settings` 32/32                       |
| One passkey, several employers (passport carries over)                                                                                                                                             | `pnpm smoke:two-employers`                                            |
| Stateless / new-device test (F9): wipe browser storage, sign in with the passkey, same balance, payslips and passport                                                                              | `pnpm e2e:stateless` 12/12                                            |

All scripts run against the Convex deployment in `.env.local` (dev) and need `pnpm dev` for the Next routes. Shared helpers: `apps/web/scripts/lib/{testnet,browser}.mts`.

## Design notes (new today)

- Prod Convex has `AUTO_VERIFY_EMPLOYERS=true` (2026-10-10): every new company is verified on-chain ~1.5 s after it registers. Manolo was verified by hand.
- The worker session locks after 15 minutes idle (Mera session ended, keys wiped). The dashboard shows "Your account was ready in X seconds, with N taps" once after onboarding.

- **Verification** (`convex/requests.ts`, `core/verify.ts`): a request's scope = `verifierScope(DEMO_LENDER, 10143)`, nonce = keccak(requestId) mod r. `requests.submit` checks scope/nonce/threshold/recency and calls `IncomePassportVerifier.verify` (view, free), so only valid answers reach the paid API. `/api/v1/verify` is `mppx.charge({amount:"0.10"})` (pull mode, operator pays gas, fee goes to the operator) and returns an EIP-712 `IncomeAttestation` signed by the operator. `requests.record` is an **action** (viem lazy-loads curve code, which mutations can't) that only accepts operator-signed attestations.
- **Send home** (`core/send.ts`, `convex/transfers.ts`): the browser calls the relay with an **unauthenticated** `ConvexHttpClient`, so the server never learns the sender. Transfer receipts carry `intentHash` (the `Paid` event id), known before sending. Received CTK counts 1:1 in the one balance; `wallet.spendable` is AUSD only.
- `runs.start` now refuses a month whose payout already went out even if the run was marked failed (unverified employer).

## Accounts (2026-10-10)

| Account                | Address                                      | Funds                                      |
| ---------------------- | -------------------------------------------- | ------------------------------------------ |
| DEPLOYER               | `0xc4C10B03547cf64aFEbCdC4aA4eCF3b8752Aa22A` | ~7.9 MON                                   |
| OPERATOR               | `0x47855D8f060c1d949fb4b9DeccD8B7c333b95AfC` | ~5.7 MON (pays relay + MPP settlement gas) |
| TREASURY (demo faucet) | `0x96A7149DFEca74D150612d1F1cB42A0903CC7f8F` | ~6 MON, ~51,600 AUSD                       |
| LENDER                 | `0xf76E8721D6d893D8078c18F93C4689C13A0bFC2d` | 1 MON, ~1,999 AUSD                         |

Each smoke/e2e run moves 0.25 MON from the faucet to a test employer. Top up the faucet from DEPLOYER when it runs low (it also funds "Add test funds" in prod).

## Chainlink CRE payday workflow (packages/cre)

See `packages/cre/README.md`. CLI at `~/.cre/bin/cre` (v1.38.0), logged in (org "My Org", deploy access not enabled). Simulate from `packages/cre` (after `bun install && bunx cre-setup` in `payday/`):
`~/.cre/bin/cre workflow simulate payday --target local-simulation --non-interactive --trigger-index 0` (cron) and `--trigger-index 1 --evm-tx-hash <RootPublished tx> --evm-event-index 0` (log). `SigiloOracle` is deployed at `0xA2750a6aa2cCaD241e2c8d21d06C8C19e789890D` (mock forwarder). Broadcast a real report (the key goes from the root `.env` straight into the CLI, never printed): `cd packages/cre && ( set -a; . ../../.env; set +a; export CRE_ETH_PRIVATE_KEY="$DEPLOYER_PRIVATE_KEY"; ~/.cre/bin/cre workflow simulate payday --target staging-settings --non-interactive --trigger-index 0 --broadcast )`. Staging points at the dev backend; production config at prod. The lender console reads `SigiloOracle.rootStatus(root)` and `isLate(vault, id)`.

**Shared registry caveat:** dev and prod Convex publish roots to the same `SigiloRegistry` (history of 64 roots). Every dev payroll run pushes prod roots toward eviction, which would break prod Income Passports until the next prod payroll; keep dev payroll tests few once prod demo data exists. A CRE run pointed at one backend reports the other backend's roots as `RootMismatch`.

## Envio indexer (packages/indexer)

HyperIndex over HyperSync for all Sigilo contracts plus the AUSD transfers that matter; feeds `/network`, the lender console's portfolio and `/record/[tx]` (details: `packages/indexer/README.md`). Envio Cloud is connected to this repo (Indexer Directory `./packages/indexer`, config `config.yaml`, release branch `envio`, free Development plan).

1. Deploy: `git push origin main:envio` (each push re-indexes from block 69,704,790 in a few minutes; the old deployment serves until the new one is synced).
2. Done 2026-10-11: `NEXT_PUBLIC_ENVIO_GRAPHQL_URL=https://indexer.dev.hyperindex.xyz/177e0bd/v1/graphql` (Vercel Production + root `.env`). Free plan limit: 100 requests/min. For a new deployment, copy its GraphQL URL from the Envio dashboard into Vercel Production: `printf %s "$URL" | vercel env add NEXT_PUBLIC_ENVIO_GRAPHQL_URL production`, then redeploy prod (it's inlined at build time). Add it to `.env` for local dev too.
3. Until then every consumer degrades: `/network` says the live numbers are on their way, the lender portfolio and the record page's "Since payday" are hidden.
4. Dev plan fair use: soft limit 100k events (we're at ~150 filtered events), deployments older than 30 days are deleted, 3 deployments per indexer (delete old ones before pushing a fourth).
5. Verify against the chain any time: `cd packages/indexer && pnpm snapshot:testnet && pnpm test:testnet`.

## Pending user actions

1. One pass of the landing's scroll animation on the demo iPhone (Safari 18+ scroll timelines are untested here).

Done 2026-10-10: Vercel CLI is logged in and linked (`apps/web/.vercel`, team `bitfalt-c7c98f2c`, project `sigilo`). `OPERATOR_PRIVATE_KEY`, `LENDER_PRIVATE_KEY`, `MPP_SECRET_KEY` are set for Production and a paid call to `https://sigilo.work/api/v1/verify` settled on-chain. Add more with `printf %s "$VALUE" | vercel env add NAME production` (never echo the value), then `vercel redeploy <latest prod url> --target production`.

## Next steps

1. Prod walkthrough on real devices (iPhone + Mac): employer → invite → 3 paid months → lender check → advance → send home.
2. Demo data on prod: a verified employer, María with 3 paid months, Mom's account.
3. Landing redesign is merged (hero load sequence, parallax, scroll reveals, Income Passport / advance / send-home stories, privacy band, FAQ). Check scroll timelines on a real iPhone.
4. Demo videos (Mera UX, Mera namespaces, Agora send home, MPP), bounty write-ups, 5+ testers. README is done.
5. MON budget: top up OPERATOR (advances) and TREASURY (faucet) from DEPLOYER as they run low.

## Notes and gotchas

- If the dev server reloads every page in a loop ("[Fast Refresh] rebuilding" ~18×/s, it also burns the Envio rate limit), stop it, `rm -rf apps/web/.next/dev`, and start `pnpm dev` again.
- Convex env (both deployments): `SESSION_PRIVATE_JWK`, `SESSION_PUBLIC_JWK`, `ALLOWED_ORIGINS`, `OPERATOR_PRIVATE_KEY`, `FAUCET_PRIVATE_KEY`, `MONAD_RPC_URL`.
- Monad reserve balance: <10 MON accounts can only send value if idle for 3 blocks, and ~1 tx per 3 blocks; check receipt status.
- MPP: `mppx` pinned to 0.4.8 (what `@monad-crypto/mpp@0.0.3` was built against); `patches/@monad-crypto__mpp@0.0.3.patch` adds testnet AUSD to `erc3009Tokens`. Pass `currency` = AUSD and `decimals: 6`; create `Mppx` lazily.
- AUSD (testnet) EIP-712 domain: name `"Agora Dollar"`, version `"1"` (`name()` returns `"AUSD"`). The Agora pair quotes 1:1 (`getAmountsOut`).
- If the circuit changes: `pnpm build`, then `pnpm prove:fixture` in `packages/circuits`, then `forge test`.
- Next 16 `cacheComponents`: await runtime `params` under `<Suspense>`; `useSearchParams` pages need a Suspense boundary.
- Desktop Chrome passkeys only have PRF via Google Password Manager. Demo on iPhone + Mac with iCloud Keychain.
- `apps/web/tsconfig.tsbuildinfo` can replay stale errors; delete it if tsc disagrees with `--showConfig`.
