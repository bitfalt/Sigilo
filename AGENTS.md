# AGENTS.md

Sigilo: private payroll → private income passport (Noir ZK) → MPP-paid verifications + payroll-deducted advances, on Monad testnet. Monad Metropolis hackathon, Track 02. **Hard deadline: 2026-10-14 03:59 UTC.**

**Read first:** `SPEC.md` (source of truth for product and architecture), `HANDOFF.md` (current state and next steps), then this file.

## Repo map

- `apps/web`: Next.js 16 PWA (App Router, `cacheComponents`), Tailwind v4, shadcn/ui. **Read `apps/web/AGENTS.md`**: this Next.js version has breaking changes, and its docs live in `apps/web/node_modules/next/dist/docs/`.
- `packages/core`: shared TS (key schedule, Poseidon2 + Merkle trees, passport witness builder, constants). Uses extensionless relative imports.
- `packages/contracts`: Foundry. `forge-std` is a git submodule. `src/generated/` is generated; never edit it by hand.
- `packages/circuits`: Noir `income_passport` circuit, `scripts/build.sh`, committed `artifacts/`, and a Node prover in `js/`.
- `.claude/skills`: project skills (mera, monad, gas, concepts, addresses, mppx). `.mcp.json`: docs MCPs (Monad, MPP, Agora).

## Commands

```bash
git submodule update --init --recursive && pnpm install
pnpm dev                                  # web on localhost:3000
pnpm --filter @sigilo/web build|lint|typecheck
pnpm --filter @sigilo/core test|typecheck
cd packages/contracts && forge test       # network = "monad" is set in foundry.toml
cd packages/circuits && pnpm test         # nargo test + JS e2e (noir_js + bb.js proof)
cd packages/circuits && pnpm build        # regenerates artifacts/ and contracts/src/generated/HonkVerifier.sol
cd packages/circuits && pnpm prove:fixture  # real proof → contracts/test/fixtures (rerun after build)
```

## Pinned toolchain (don't drift)

- Node ≥ 22, pnpm 11, TypeScript 5.x (not 7).
- Foundry 1.8.5.
- **nargo 1.0.0-rc.2 + bb 5.2.1.** Verified end to end. JS must match: `@noir-lang/noir_js@1.0.0-rc.2`, `@aztec/bb.js@5.2.1`. Always pass `-t evm` to bb for anything EVM.
- Noir Poseidon2 comes from `noir-lang/poseidon` v0.4.0. It is not in the stdlib anymore.
- `viem` 2.57.x (mppx 0.13 needs ≥ 2.57.1).
- `@category-labs/mera` 0.2.x.

## Conventions

- **English only** in code, docs and commits.
- **Conventional Commits, small and atomic.** Scopes: `web`, `core`, `contracts`, `circuits`, `agents`, `docs`. Commit after each coherent step.
- Run the relevant typecheck, lint and tests before committing. Format with Prettier, `forge fmt` and `nargo fmt`.
- Crypto/hash code needs tests with **pinned vectors**.

## Invariants: never change silently

These are part of user identity and of on-chain state:

- Key derivation salts, labels and path (`packages/core/src/keys.ts`, see the mera skill).
- Hash domain tags and input layouts, tree depths, `PERIODS` (`packages/circuits/income_passport/src/lib.nr` ↔ `packages/core`).
- Period = month index (`year*12 + month-1`), and gross/threshold are u64 USD cents (`packages/core/src/period.ts`, `constants.ts`).

Changing any of them means updating both sides plus the vectors, then running `pnpm build` and `pnpm prove:fixture` in circuits and redeploying the verifier.

## Security and privacy

- Never persist or log PRF outputs, private keys, seeds or the passport secret. Cache only public identity.
- Server-only secrets (`*_PRIVATE_KEY`, `SESSION_SECRET`, `MPP_SECRET_KEY`) must never be imported into client code or prefixed `NEXT_PUBLIC_`.
- Testnet only. Verify every address on an explorer.
- Worker accounts are **Mera-only**. Do not add Privy or Dynamic; the Mera bounties require Mera to be the entire account layer.

## UX copy (judged harshly)

Never show: wallet, gas, token, transaction, chain, ZK, proof, hash, address, seed. Use instead: account, digital dollars, payment, payslip, Income Passport, verified, private. See `SPEC.md` §13.

## Skills to use

- `mera`: onboarding, keys, signing.
- `mppx`: paid API.
- `monad`, `gas`, `concepts`, `addresses`: Monad specifics. Prefer these over the Ethereum-generic `ethskills:*` equivalents.
- `noir:*`: circuits and noir_js.
- `ethskills:security`: before deploying contracts.
- `frontend-design`: UI work.
