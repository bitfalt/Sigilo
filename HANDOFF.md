# Handoff — 2026-10-09 (evening)

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
- Root `.env` exists (gitignored, `chmod 600`); `apps/web/.env.local` is a symlink to it. `SESSION_SECRET` is set. The `*_PRIVATE_KEY` values are empty (auto-mode blocked generating them). The old `UNLINK_*` lines are unused.

## Pending user actions

1. **Fill and fund keys:** run the fill-in command (in chat) for `OPERATOR`, `TREASURY`, `LENDER`, `DEPLOYER`. Fund `DEPLOYER` (and ideally `OPERATOR`) with MON from faucet.monad.xyz.
2. **Production domain** (a subdomain) → `NEXT_PUBLIC_RP_ID`; deploy to Vercel on it. Blocks S1.
3. **Convex:** run `npx convex dev` in `apps/web` (interactive login).

## Next steps (in order)

1. **`packages/core`:**
   - Remove the Unlink seed derivation and `UNLINK_ENVIRONMENT`; retire the label.
   - Add stealth spend/view keys, one-time-account derivation (sender + owner), denomination split, coin selection, and the `SigiloPay` intent/nonce hashing. Pin vectors (cross-check with `cast`).
2. **`SigiloPay`** (`disperse`, `collect`, `sendHome`) with Foundry tests using a mock ERC-3009 token, plus a fork test against testnet AUSD. Run `ethskills:security`.
3. **Deploy** `SigiloRegistry`, `HonkVerifier`, `IncomePassportVerifier` and `SigiloPay` (which whitelists itself on Agora). Verify on the explorer, fill `NEXT_PUBLIC_*_ADDRESS`. Run S2 on testnet.
4. **Phase 3, accounts + payroll** (SPEC §15.2): Mera onboarding, Convex schema, employer dashboard, payroll run, worker balance/payslips.
5. Then verification (Phase 4), Send home + Advanced + advance (Phase 5), polish and ship.

## Notes and gotchas

- If the circuit changes: `pnpm build`, then `pnpm prove:fixture` in `packages/circuits`, then `forge test`.
- Proof fixtures use the scope of a dummy verifier (`0x…DeaDBeef`). `AdvanceVault` tests need a fixture whose scope is the vault (pass `scope` to `demoScenario`).
- AUSD (testnet) EIP-712 domain: name `"Agora Dollar"`, version `"1"` (`name()` returns `"AUSD"`).
- MPP: pass `currency` = AUSD; `pnpm patch @monad-crypto/mpp` to add AUSD to `erc3009Tokens` for pull mode; create `Mppx` lazily.
- pnpm 11 `allowBuilds`: `esbuild` and `msgpackr-extract` are denied; tsx and bb.js work without them.
- Next 16 `cacheComponents`: await runtime `params` under `<Suspense>` (see `/v/[requestId]`).
- Desktop Chrome passkeys only have PRF via Google Password Manager. Demo on iPhone + Mac with iCloud Keychain.
