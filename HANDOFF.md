# Handoff — 2026-10-09

Start a new session with: *"Read SPEC.md, AGENTS.md and HANDOFF.md, then continue with the next steps."*

## Done (see `git log`; everything is pushed to `origin/main`, which is public)
- Everything from 2026-10-08: spec, agent tooling, monorepo, web scaffold, key schedule, `SigiloRegistry`, `income_passport` circuit and the generated `HonkVerifier`.
- `packages/core`:
  - Poseidon2 (`@zkpassport/poseidon2`, pure TS), domain-tagged hashes mirroring `lib.nr`, sparse Merkle trees, month-index periods, verifier scope.
  - `buildPassportInputs`: payslips + registry leaves → circuit inputs and public inputs, with coded errors.
  - 24 tests. Cross-language vectors are pinned in both `hash.test.ts` and `tests.nr`.
- `packages/circuits`:
  - A Node prover in `js/` (noir_js + bb.js, EVM target) and an e2e test: prove, verify, reject a tampered claim, and check `core` Poseidon2 against Barretenberg.
  - `pnpm prove:fixture` writes a real proof to `contracts/test/fixtures/`.
- `packages/contracts`: `IncomePassportVerifier`. `verify` checks for a known root and maps reverts to false; `attest` consumes the (scope, nonce) and emits `PassportVerified`. 18 Foundry tests pass, including the real proof (~5.4M gas).
- Spikes S3–S5 researched and recorded in `SPEC.md` §11 and §15.1 (results), and §17.
- Verified Agora testnet addresses are in `core/src/constants.ts`.
- Root `.env` exists (gitignored, `chmod 600`). `apps/web/.env.local` is a symlink to it. It holds `UNLINK_TREASURY_MNEMONIC` and `SESSION_SECRET`. **The three `*_PRIVATE_KEY` values are still empty**, because the auto-mode classifier blocked generating them; the user will run the fill-in command.

## Decisions this session
- Committed amounts (gross pay, thresholds) are **u64 USD cents**, and periods are month indexes. Both are invariants (AGENTS.md).
- `AdvanceVault` (P1) is deferred until Phase 1 (accounts + payroll) works.
- Storage: the user is leaning toward **Convex** instead of Postgres/Drizzle. If confirmed, Convex holds the data; Next route handlers keep the Unlink auth routes and the MPP-gated `/api/v1/verify`. Update SPEC §10 when Phase 1 starts.
- Production domain: a subdomain of the user's personal domain (not chosen yet).

## Pending user actions
1. **Unlink:** get the API key into `.env`, and **ask Unlink (Telegram/Discord) about the `monad-testnet` Engine.** `monad-testnet-production-api.unlink.xyz` currently points to a fly.dev host with no DNS record. This blocks S2, S3 and all payroll.
2. **Production domain** (subdomain) → `NEXT_PUBLIC_RP_ID`, and deploy to Vercel on it. Blocks S1.
3. **Fill and fund keys:** run the fill-in command (from chat) to generate `OPERATOR`/`LENDER`/`DEPLOYER` keys into `.env`, then fund at least `DEPLOYER` from faucet.monad.xyz.
4. **Confirm Convex**, then run `npx convex dev` in `apps/web` (interactive login).

## Next steps (in order)
1. **Deploy** `SigiloRegistry`, `HonkVerifier` and `IncomePassportVerifier` to Monad testnet (`forge script`, needs a funded `DEPLOYER`). Run `ethskills:security` first. Verify on the explorer and fill the `NEXT_PUBLIC_*_ADDRESS` values.
2. **Phase 1, accounts + payroll** (SPEC §15.2), once Unlink is reachable:
   - Mera onboarding (S1 on the real domain).
   - Worker Unlink account from the seed; employer treasury (custodial).
   - Convex schema (employers, employees, invites, runs, payslips, registry leaves).
   - Payroll run: Unlink multi-recipient transfer + run tree + registry leaf + `publishRoot` + encrypted payslips.
   - S3: try `depositWithApproval` with testnet AUSD.
3. **Phase 3, verification:** browser proving (Web Worker, measure on a phone), verification requests, the MPP-gated Verify API (AUSD + `pnpm patch` for pull mode), lender console.
4. Then Phase 4 (`AdvanceVault`, mandates, Send home with Agora), polish, ship.

## Notes and gotchas
- If the circuit changes: `pnpm build`, then `pnpm prove:fixture` in `packages/circuits`, then `forge test`.
- Proof fixtures use the scope of a dummy verifier (`0x…DeaDBeef`). `AdvanceVault` tests will need a fixture whose scope is the vault's address (pass a `scope` to `demoScenario`).
- pnpm 11 `allowBuilds`: `esbuild` and `msgpackr-extract` are denied. tsx and bb.js work without them.
- MPP: create `Mppx` lazily (it throws without `secretKey`). Set `mode: "pull"` explicitly on the client (it's unconfirmed whether Mera's `toViemAccount` counts as a local account).
- Agora's `setApprovedSwapper` can whitelist any address, including an Unlink execution account.
- Next 16 `cacheComponents`: await runtime `params` under `<Suspense>` (see `/v/[requestId]`).
- Desktop Chrome passkeys only have PRF via Google Password Manager. Demo on iPhone + Mac with iCloud Keychain.
