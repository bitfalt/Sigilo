# Handoff — 2026-10-10 (early morning)

Start a new session with: _"Read SPEC.md, AGENTS.md and HANDOFF.md, then continue with the next steps."_

Deadline: **2026-10-14 03:59 UTC** (Oct 13, 21:59 CST). Target submit Oct 13 18:00 CST.

## Live

- **sigilo.work** on Vercel (Root `apps/web`, build `npx convex deploy --cmd 'pnpm run build'`). Prod Convex `bold-marlin-213`, dev `brazen-poodle-85`.
- Pages: `/` (landing with a scroll-driven "split" of María's pay), `/app` (worker), `/app/invite/[code]`, `/app/send`, `/app/receive`, `/employer`, `/lender`, `/v/[requestId]`, `/api/v1/verify` (MPP-paid), `/api/lender/verify`.
- Contracts on Monad testnet, verified: `packages/core/src/deployments.ts`.

## What works end to end (testnet)

| Flow                                                                                                                              | Proof it works                                                        |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Payroll in fixed pieces to one-time accounts, blind server                                                                        | `pnpm smoke:payroll` 13/13                                            |
| Passkey create/sign-in (prod)                                                                                                     | `pnpm e2e:passkey https://sigilo.work` 10/10                          |
| Income Passport: request → browser proof (≈6.4 s headless) → free on-chain check → lender pays $0.10 via MPP → signed attestation | `pnpm smoke:passport` 16/16, `pnpm e2e:passport` 19/19 (real UI)      |
| Send home: pieces sign ERC-3009 → unauthenticated relay → `SigiloPay.sendHome` (AUSD→CTK on Agora) → Mom's receipt                | `pnpm smoke:sendhome`, `pnpm e2e:sendhome` 14/14 (delivered in 0.7 s) |

All scripts run against the Convex deployment in `.env.local` (dev) and need `pnpm dev` for the Next routes. Shared helpers: `apps/web/scripts/lib/{testnet,browser}.mts`.

## Design notes (new today)

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

## Pending user actions

1. **Vercel env (Production):** `OPERATOR_PRIVATE_KEY`, `LENDER_PRIVATE_KEY`, `MPP_SECRET_KEY` (values in the root `.env`). Without them `/api/v1/verify` and `/api/lender/verify` fail in prod. Optional: `MONAD_TESTNET_RPC_URL`.
2. Decide: verify the prod company "Manolo" (`npx convex run --prod employers:verify '{"employer":"<id>"}'`) or create "Acme Labs" for the demo.
3. One pass of the landing's scroll animation on the demo iPhone (Safari 18+ scroll timelines are untested here).

## Next steps

1. Prod check after the env vars: run `pnpm e2e:passport https://sigilo.work` (spends testnet money) or click through `/lender` + `/v/...` on a phone.
2. Demo data on prod: a verified employer, María with 3 paid months, Mom's account.
3. P1: Advanced settings (export keys, move everything out; step-up + warning) and the payroll-deducted advance (`AdvanceVault`, F7).
4. README, demo videos (Mera UX, Mera namespaces, Agora send home, MPP), bounty write-ups, testers.

## Notes and gotchas

- If the dev server starts reloading pages in a loop after big merges, restart `pnpm dev`.
- Convex env (both deployments): `SESSION_PRIVATE_JWK`, `SESSION_PUBLIC_JWK`, `ALLOWED_ORIGINS`, `OPERATOR_PRIVATE_KEY`, `FAUCET_PRIVATE_KEY`, `MONAD_RPC_URL`.
- Monad reserve balance: <10 MON accounts can only send value if idle for 3 blocks, and ~1 tx per 3 blocks; check receipt status.
- MPP: `mppx` pinned to 0.4.8 (what `@monad-crypto/mpp@0.0.3` was built against); `patches/@monad-crypto__mpp@0.0.3.patch` adds testnet AUSD to `erc3009Tokens`. Pass `currency` = AUSD and `decimals: 6`; create `Mppx` lazily.
- AUSD (testnet) EIP-712 domain: name `"Agora Dollar"`, version `"1"` (`name()` returns `"AUSD"`). The Agora pair quotes 1:1 (`getAmountsOut`).
- If the circuit changes: `pnpm build`, then `pnpm prove:fixture` in `packages/circuits`, then `forge test`.
- Next 16 `cacheComponents`: await runtime `params` under `<Suspense>`; `useSearchParams` pages need a Suspense boundary.
- Desktop Chrome passkeys only have PRF via Google Password Manager. Demo on iPhone + Mac with iCloud Keychain.
- `apps/web/tsconfig.tsbuildinfo` can replay stale errors; delete it if tsc disagrees with `--showConfig`.
