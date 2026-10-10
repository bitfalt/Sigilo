# Handoff — 2026-10-09 (night)

Start a new session with: _"Read SPEC.md, AGENTS.md and HANDOFF.md, then continue with the next steps."_

## Big change today: Unlink is gone

Every hosted Unlink environment (mainnets included) points to a fly.dev host that no longer exists, and the dashboard returns 404. Unlink wasn't a sponsor bounty. **Private payouts are now "unlinkable payroll"** (SPEC §5, §6.1, §9):

- Each payday the net pay is split into fixed pieces (1-2-5 series, $1,000 → $0.01).
- Each piece goes to a fresh one-time account (ERC-5564-style stealth address) derived from the worker's passkey keys.
- The ephemeral key travels inside the encrypted payslip ("receipt"), so nothing is announced on-chain.
- Workers see **one balance** (sum of pieces) and make **one payment**. The app signs one AUSD ERC-3009 authorization per piece; the operator relays them through `SigiloPay`. Workers never hold MON.
- **Advanced settings** (opt-in, step-up + warning): move everything to an external account; export keys.
- **Send home is now P0** (Agora cross-border bounty, $10k, same track). Storage is **Convex**.

## Done (all pushed to `origin/main`, public)

- Scaffold, key schedule, `SigiloRegistry`, `income_passport` circuit + generated `HonkVerifier`.
- `packages/core`: Poseidon2 + trees + periods + scope + passport witness builder, with cross-language vectors (24 tests).
- `packages/circuits`: Node prover (noir_js + bb.js, EVM target), e2e test, `pnpm prove:fixture`.
- `packages/contracts`: `IncomePassportVerifier`, verified against a real proof (18 Foundry tests, ~5.4M gas).
- SPEC v0.2 rewritten for the new design; S3–S5 research recorded in SPEC §11; Agora testnet addresses verified on-chain and saved in `core/src/constants.ts`.
- `packages/core` (37 tests): Unlink seed removed; stealth spend/view keys; one-time accounts (`createOneTimeAccount` / `oneTimeAccountKey`); pieces (`splitIntoPieces`, `selectPieces`, `shuffled`); spend intents (`intentHash`, `authorizationNonce`, `signIntentAuthorizations`). Vectors cross-checked with `cast`.
- `packages/contracts`: `SigiloPay` (`disperse`, `collect`, `sendHome`), 36 tests incl. a 5,000-run fuzz, plus `pnpm test:fork`, which runs payroll → combined payment → swap against the **real** testnet AUSD + Agora pair (passes). Pre-deploy checklist done (ethskills:security, forge lint, Slither: no medium/high).
- `script/Deploy.s.sol` + `pnpm deploy:testnet` (broadcast + Sourcify verification on MonadVision). Dry run OK: ~10.2M gas ≈ **2.08 MON**.
- Agent tooling: Unlink skill and docs MCP removed; mera skill updated.
- Root `.env` exists (gitignored, `chmod 600`); `apps/web/.env.local` is a symlink to it. `SESSION_SECRET` is set. The `*_PRIVATE_KEY` values are empty (auto-mode blocked generating them). The old `UNLINK_*` lines are unused.

## Deployed (Monad testnet, verified on MonadVision)

Addresses are in `packages/core/src/deployments.ts`: `SigiloRegistry` (operator = OPERATOR), `HonkVerifier`, `IncomePassportVerifier`, `SigiloPay` (Agora approved swapper). The deployed `HonkVerifier` accepts a real TS-generated proof.

| Account  | Address                                      | Funds (2026-10-09) |
| -------- | -------------------------------------------- | ------------------ |
| DEPLOYER | `0xc4C10B03547cf64aFEbCdC4aA4eCF3b8752Aa22A` | ~5.9 MON           |
| OPERATOR | `0x47855D8f060c1d949fb4b9DeccD8B7c333b95AfC` | ~6 MON             |
| TREASURY | `0x96A7149DFEca74D150612d1F1cB42A0903CC7f8F` | ~1 MON, 8,000 AUSD |
| LENDER   | `0xf76E8721D6d893D8078c18F93C4689C13A0bFC2d` | ~1 MON, 2,000 AUSD |

The Agora AUSD faucet has a global cooldown (`MaxFrequencyExceeded()`). Keys are in the root `.env` only. Never print them; load with `set -a; . ./.env; set +a` inside a subshell.

Convex is installed in `apps/web` (schema in `convex/schema.ts`, dev deployment `brazen-poodle-85`, `pnpm dev:convex`, AI guidelines + agent skills; the Convex plugin is installed for Claude Code and Codex).

## Pending user actions

1. **Vercel:** import `bitfalt/Sigilo`, Root Directory `apps/web`, env `ENABLE_EXPERIMENTAL_COREPACK=1`, `NEXT_PUBLIC_RP_ID=sigilo.work`, `NEXT_PUBLIC_RP_NAME=Sigilo`, `NEXT_PUBLIC_MONAD_RPC_URL`, `NEXT_PUBLIC_EXPLORER_URL`. Add domains `sigilo.work` + `www` (redirect).
2. **Porkbun DNS for `sigilo.work`** (bought 2026-10-09): delete the default parking records, add the records Vercel shows, and set up email forwarding `hello@sigilo.work` → Proton (or a Proton custom domain on a paid plan).
3. **X account** with `hello@sigilo.work`.
4. **UI style direction:** planned for 2026-10-10 with the user.

## Next steps (in order)

Done since the last handoff: blind-server design (SPEC §5, F2/F3, S_EMPLOYER), core roster encryption + `preparePayrollRun` (52 tests), Convex sign-in (custom ES256 JWT after a Mera EVM signature; `pnpm smoke:auth`), and the Convex payroll backend (accounts, employers, employees, receipts, runs, registry + operator publish). **`pnpm smoke:payroll` passes end to end on testnet** (real payout, root published, worker decrypts pay, balances match).

1. **Client wiring (functional, unstyled until the UI session):**
   - Convex provider with `ConvexProviderWithAuth` (token from `/auth/session`).
   - Mera onboarding: worker (S_ACCOUNT, then S_PASSPORT step-up) and employer admin (S_EMPLOYER); keys only in memory.
   - Worker: register keys, accept invite, activate passport, balance (Multicall3) + payslips.
   - Employer: register, add employees (roster encryption + invite links), fund treasury (demo faucet action), run payroll in the browser (approve + disperse with Monad spacing/retries, then `runs.submit`).
2. **Verification (Phase 4):** browser proving (Web Worker), verification requests, MPP-gated Verify API (pass `currency` = AUSD; patch mppx pull mode), lender console.
3. **Phase 5:** Send home (relayed `SigiloPay.sendHome`), Advanced settings, advance (P1).
4. Verify `acme` in prod Convex too (`npx convex run employers:verify` on the prod deployment) once Vercel deploys it.

## Notes and gotchas

- Convex env (dev `brazen-poodle-85`): `SESSION_PRIVATE_JWK`, `SESSION_PUBLIC_JWK`, `ALLOWED_ORIGINS`, `OPERATOR_PRIVATE_KEY`, `MONAD_RPC_URL`. Prod needs the same (`npx convex env set --prod ...`).
- Monad reserve balance: <10 MON accounts can only send value if idle for 3 blocks, and ~1 tx per 3 blocks; check receipt status (see `scripts/smoke-payroll.mts`).
- `apps/web/tsconfig.tsbuildinfo` can replay stale errors; delete it if tsc disagrees with `--showConfig`.

- If the circuit changes: `pnpm build`, then `pnpm prove:fixture` in `packages/circuits`, then `forge test`.
- `packages/contracts/.env` is a gitignored symlink to the root `.env` (Foundry reads it). Fork tests need `pnpm test:fork`.
- Sending home: `minOut` is in CTK (18 decimals) = AUSD amount × 1e12 × (1 − slippage); the pair is 1:1 with zero fees today.
- Proof fixtures use the scope of a dummy verifier (`0x…DeaDBeef`). `AdvanceVault` tests need a fixture whose scope is the vault (pass `scope` to `demoScenario`).
- AUSD (testnet) EIP-712 domain: name `"Agora Dollar"`, version `"1"` (`name()` returns `"AUSD"`).
- MPP: pass `currency` = AUSD; `pnpm patch @monad-crypto/mpp` to add AUSD to `erc3009Tokens` for pull mode; create `Mppx` lazily.
- pnpm 11 `allowBuilds`: `esbuild` and `msgpackr-extract` are denied; tsx and bb.js work without them.
- Next 16 `cacheComponents`: await runtime `params` under `<Suspense>` (see `/v/[requestId]`).
- Desktop Chrome passkeys only have PRF via Google Password Manager. Demo on iPhone + Mac with iCloud Keychain.
