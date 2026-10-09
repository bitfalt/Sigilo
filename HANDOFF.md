# Handoff — 2026-10-08

Start a new session with: *"Read SPEC.md, AGENTS.md and HANDOFF.md, then continue with the next steps."*

## Done (see `git log`)
- `SPEC.md`: full product and technical spec.
- Agent tooling: project skills (incl. the custom `mera` skill), docs MCPs (`.mcp.json`), and `AGENTS.md`/`CLAUDE.md`.
- pnpm monorepo scaffold, `.gitignore`, `.env.example`.
- `apps/web`: Next 16 + Tailwind v4 + shadcn/ui, PWA manifest, placeholder routes `/`, `/app`, `/employer`, `/lender`, `/v/[requestId]`. Builds, lints and typechecks.
- `packages/core`: key schedule (EVM key, Unlink seed, payslip X25519, BN254 passport secret) with pinned vectors (8 tests pass). The EVM address was cross-checked with `cast`.
- `packages/contracts`: `SigiloRegistry` (8 tests pass) and the generated `HonkVerifier.sol` (18.2 KB, compiles).
- `packages/circuits`: `income_passport` circuit, 9,360 gates, 11 tests pass. Build script and artifacts are committed.
- Toolchain on this machine: Foundry 1.8.5, nargo 1.0.0-rc.2, bb 5.2.1 (PATH lines are in `~/.zshrc`).
- **Spikes resolved:**
  - S6 is partly done: CLI prove → verify → Solidity verifier works.
  - S7: a PWA counts for the Agora bounty (confirmed on Discord).
  - CRE supports Monad testnet for simulation.

## Pending user actions
1. **Pick the production domain** (passkey rpId) and set `NEXT_PUBLIC_RP_ID`.
2. **Unlink API key** at dashboard.unlink.xyz (Monad testnet project) → `.env`.
3. Postgres (Neon/Supabase) → `DATABASE_URL`.
4. Fund `OPERATOR`/`DEPLOYER` keys from faucet.monad.xyz.

## Next steps (in order)
1. **TS Poseidon2 + trees in `packages/core`.** Must match the Noir vector `Poseidon2::hash([1,2],2) = 0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383`. Try bb.js `poseidon2Hash` first and verify it matches. Mirror `lib.nr` exactly (domain tags 1–5, layouts, depths).
2. **End-to-end proof.** Generate a valid witness from TS, prove with noir_js + bb.js (EVM target), and add a Foundry test that verifies a real proof against `HonkVerifier`. Then build `IncomePassportVerifier` (checks `SigiloRegistry.isKnownRoot`) and `AdvanceVault`.
3. **Spikes S1–S5** (SPEC §15.1):
   - S1: Mera PRF on real devices.
   - S2: Unlink on monad-testnet, including mobile proving time.
   - S3: can Unlink hold AUSD?
   - S4: Agora testnet whitelist + swap (guide: docs.agora.finance/instant-settlement/guides/getting-testnet-tokens.md).
   - S5: MPP token/amount config.
4. Then follow the SPEC §15.2 phases (accounts + payroll → verification → credit + Send home → polish → ship).

## Notes and gotchas
- `packages/circuits/income_passport/Prover.toml` is nargo's zero template. Generate a real one from TS.
- Next 16 `cacheComponents`: await runtime `params` under `<Suspense>` (see `/v/[requestId]`).
- Desktop Chrome passkeys only have PRF via Google Password Manager. Demo on iPhone + Mac with iCloud Keychain.
- Nothing has been pushed. Commits are local on `main`.
