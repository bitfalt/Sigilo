# Handoff — 2026-10-09 (late night)

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

Convex is installed in `apps/web` (empty schema, `pnpm dev:convex`, AI guidelines + agent skills; the Convex plugin is installed for Claude Code and Codex).

## Pending user actions

1. **Convex login:** in a separate terminal, `cd apps/web && pnpm dev:convex` (creates the project and writes `CONVEX_DEPLOYMENT` / `NEXT_PUBLIC_CONVEX_URL` into the root `.env` through the symlink). Keep it running while developing.
2. **Production domain** (a subdomain) → `NEXT_PUBLIC_RP_ID`; deploy to Vercel on it. Blocks S1.

## Next steps (in order)

1. **Mark the demo employer verified** (`setEmployerVerified`, OPERATOR key) once its id exists in Convex.
2. **Phase 3, accounts + payroll** (SPEC §15.2):
   - Mera onboarding (S1 on the real domain).
   - Convex schema.
   - Receipt encryption (X25519 + AEAD) in core.
   - Employer dashboard and payroll run: pieces → `disperse` (approve the exact amount) → run tree → registry leaf → `publishRoot` → receipts.
   - Worker balance (Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11`, verified on testnet) and payslips.
3. **Relayer** (`POST /api/relay`): tight gas limits (Monad charges the limit), operator nonce tracking.
4. Then verification (Phase 4), Send home + Advanced + advance (Phase 5), polish and ship.

## Notes and gotchas

- If the circuit changes: `pnpm build`, then `pnpm prove:fixture` in `packages/circuits`, then `forge test`.
- `packages/contracts/.env` is a gitignored symlink to the root `.env` (Foundry reads it). Fork tests need `pnpm test:fork`.
- Sending home: `minOut` is in CTK (18 decimals) = AUSD amount × 1e12 × (1 − slippage); the pair is 1:1 with zero fees today.
- Proof fixtures use the scope of a dummy verifier (`0x…DeaDBeef`). `AdvanceVault` tests need a fixture whose scope is the vault (pass `scope` to `demoScenario`).
- AUSD (testnet) EIP-712 domain: name `"Agora Dollar"`, version `"1"` (`name()` returns `"AUSD"`).
- MPP: pass `currency` = AUSD; `pnpm patch @monad-crypto/mpp` to add AUSD to `erc3009Tokens` for pull mode; create `Mppx` lazily.
- pnpm 11 `allowBuilds`: `esbuild` and `msgpackr-extract` are denied; tsx and bb.js work without them.
- Next 16 `cacheComponents`: await runtime `params` under `<Suspense>` (see `/v/[requestId]`).
- Desktop Chrome passkeys only have PRF via Google Password Manager. Demo on iPhone + Mac with iCloud Keychain.
