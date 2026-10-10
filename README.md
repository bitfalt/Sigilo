# Sigilo

**The original proof of work.** Get paid in digital dollars without your salary on display. Prove what you earn without handing over your payslips. Send money home in under a second. Borrow against your next paycheck.

Live at **[sigilo.work](https://sigilo.work)** · Monad testnet · Monad Metropolis, Track 02 (Consumer Products & Payments)

| For       | Open                                                 | What you can do                                                                             |
| --------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Employers | [sigilo.work/employer](https://sigilo.work/employer) | Create a company with a passkey, add test funds, invite people, run payroll in one click    |
| Workers   | [sigilo.work/app](https://sigilo.work/app)           | One balance, private payslips, Income Passport, send money home, take a salary advance      |
| Lenders   | [sigilo.work/lender](https://sigilo.work/lender)     | Ask for an income check, verify it for $0.10, offer an advance repaid straight from payroll |

## Try it (judges and testers)

No test credentials needed: every account is a passkey you create on the spot, the lender is built in, and test money comes from a button. It runs on Monad testnet.

**You need** a passkey manager that supports the WebAuthn PRF extension: Apple Passwords / iCloud Keychain (Safari or Chrome on iPhone and Mac), Google Password Manager (Chrome on Android, or desktop Chrome signed in), or 1Password. Bitwarden doesn't support PRF yet. Best setup: a laptop for the employer and lender, a phone for the worker.

1. **Employer** (laptop): open [sigilo.work/employer](https://sigilo.work/employer) → _Create company account_. On testnet every company is verified automatically (KYB is simulated). Tap _Add test funds_, then add a person with a monthly salary (e.g. $2,400) and copy the invite link.
2. **Worker** (phone): open the invite → _Create my account_ → _Activate Income Passport_. That's two passkey taps; the app shows how many seconds it took.
3. **Payroll** (laptop): run payroll for the three previous months (pick each month chip, then _Run payroll_). Each run is one payout of shuffled, fixed-size pieces; _What the internet sees_ next to each run shows the public view. On the phone, the balance and payslips appear.
4. **Income check** (laptop): open [sigilo.work/lender](https://sigilo.work/lender) → _New income check_ with a minimum at or below the salary (e.g. $1,500). Scan the QR with the phone → _Share my Income Passport_ (sealed on the phone in a few seconds). Back on the lender: _Verify for $0.10_ pays the Sigilo Verify API through MPP and shows _Income verified_.
5. **Advance**: on the lender, _Offer a salary advance_. The offer appears on the phone's income-check page → _Take_. Run payroll for the current month: the installment is deducted on the payslip and repaid to the lender, who sees the progress.
6. **Send home**: create a second account in another browser or device (that's Mom) → _Get money from family_ → share the link. Open it on the worker's phone → _Send_. It's delivered in about a second and shows up on Mom's account as _Money from María_.
7. **New device**: clear the site's data (or use another device with the same synced passkey) → _Sign in with a passkey_. Balance, payslips and the Income Passport come back; nothing secret was stored.
8. **Settings → Advanced** (behind a second passkey check): move everything to an external account, or export the keys.

## The problem

Paying a remote team in stablecoins is fast and cheap, but it is **public payroll**: anyone who learns a worker's account can read her salary, her employer and her pay dates. In Latin America that is a safety problem, not just a privacy one. Meanwhile, proving income to rent an apartment or get a loan still means handing over contracts, payslips and bank statements, and foreign income in digital dollars is invisible to local credit.

## What Sigilo does

1. **Private payroll.** The employer's browser decrypts the roster, splits each net salary into fixed pieces ($1,000, $500, $200, … $0.01) and pays every piece to a fresh one-time account derived from the worker's passkey. All pieces of all workers are shuffled into one payout. On-chain you see that a company paid N identical-looking pieces; you can't tell which belong to whom. The worker sees **one balance** and makes **one payment**.
2. **Income Passport.** Every payroll run commits each payslip to a Merkle tree, and Sigilo publishes the run roots on-chain. María proves _"at least $1,500 a month for the last 3 months, from a verified employer"_ with a Noir circuit, **in her browser in about 6 seconds**, without revealing her employer, salary or payslips. Each lender sees a different pseudonym, so lenders can't compare notes.
3. **Paid verification (MPP).** Lenders pay **$0.10 per check** to the Sigilo Verify API through the Machine Payments Protocol (AUSD, ERC-3009 pull mode, so the lender needs no gas). The API checks the proof against the on-chain verifier and returns a signed attestation.
4. **Send home (Agora).** María sends money to her mom: her pieces sign authorizations bound to that exact payment, a relayer submits them, and Agora converts AUSD to local money at a fixed price on the way. **Delivered in 0.7 s** in our end-to-end test. Mom joins with a link and her own passkey.
5. **Salary advances repaid from payroll.** After a verified check, the lender offers an advance (up to 30% of the verified monthly income). María proves her income to the lender's vault, gets the money in a fresh account, and signs a deduction mandate; her employer's next payroll repays the vault automatically, like _crédito consignado_ or _deducción de planilla_.

No seed phrases, no extensions, no passwords: **a passkey is the account** ([Mera](https://mera.category.xyz)), and it works on a new phone. One passkey works with any number of employers. For people who manage their own accounts, **Settings → Advanced** (behind a second passkey check) moves everything to an external account or exports the keys.

## Privacy model ("if we get hacked")

- Names, salaries and payslips are encrypted on the employer's and worker's devices. Sigilo's servers store ciphertext and public keys only.
- Which payment piece belongs to whom is **never stored anywhere**: the one-time account keys travel inside the worker's encrypted payslip.
- Send home is relayed **without a session**: the server can't tell who sent it.
- Keys are derived from the passkey (WebAuthn PRF) on every unlock and never persisted. Separate PRF namespaces for the account, the Income Passport and the employer treasury.
- What is public: a company funded its treasury and paid N fixed-size pieces; registry roots; verification and advance events.

Details: [SPEC.md §5](SPEC.md).

## Built with

| Sponsor / tech                                  | Used for                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Monad** (testnet, chain 10143)                | All contracts; sub-second payouts and transfers                                                                                                         |
| **Mera** (`@category-labs/mera`)                | The entire account layer: passkey onboarding, signing sessions, and PRF namespaces for non-account keys (passport secret, treasury, payslip encryption) |
| **Agora** (AUSD + Instant Settlement)           | Payroll in AUSD; Send home swaps AUSD → CTK on the Agora pair via `SigiloPay.sendHome`                                                                  |
| **MPP** (`mppx` + `@monad-crypto/mpp`)          | `/api/v1/verify`, paid per call in AUSD (pull mode / ERC-3009)                                                                                          |
| **Noir** + Barretenberg (UltraHonk, EVM target) | `income_passport` circuit, proved in the browser with noir_js + bb.js, verified on-chain by a generated `HonkVerifier`                                  |
| Convex, Next.js 16, Vercel                      | Blind backend (ciphertext, public keys, live status), app and API routes                                                                                |

## Contracts (Monad testnet, verified on MonadVision)

| Contract                        | Address                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `SigiloRegistry`                | [`0xba306ac85e31D43b92bc1915fF84354A08140A8B`](https://testnet.monadvision.com/address/0xba306ac85e31D43b92bc1915fF84354A08140A8B) |
| `HonkVerifier`                  | [`0xB2C7D31fd760e085D13c4D3FC40fAE3b40c56177`](https://testnet.monadvision.com/address/0xB2C7D31fd760e085D13c4D3FC40fAE3b40c56177) |
| `IncomePassportVerifier`        | [`0x0e40B46A82a79C0a4b0A9957bBD32AE6B5a4B290`](https://testnet.monadvision.com/address/0x0e40B46A82a79C0a4b0A9957bBD32AE6B5a4B290) |
| `SigiloPay`                     | [`0xBeDbFae158ed456E546bC0eE2c2b1405F8AbB701`](https://testnet.monadvision.com/address/0xBeDbFae158ed456E546bC0eE2c2b1405F8AbB701) |
| `AdvanceVault` (Fondo Quincena) | [`0xdB38A7F37f45934A42f4ddD740d8F69414de7734`](https://testnet.monadvision.com/address/0xdB38A7F37f45934A42f4ddD740d8F69414de7734) |

Source of truth: [`packages/core/src/deployments.ts`](packages/core/src/deployments.ts).

## Repository

```
apps/web             Next.js 16 PWA (landing, /app, /employer, /lender, /v/[id], API routes) + Convex backend
packages/core        Shared TypeScript: key schedule, Poseidon2 + Merkle trees, one-time accounts, pieces,
                     spend intents, encrypted receipts, passport witness builder, attestations
packages/circuits    Noir income_passport circuit, generated artifacts, Node prover
packages/contracts   Foundry: SigiloRegistry, IncomePassportVerifier, HonkVerifier (generated), SigiloPay, AdvanceVault
```

## Run it locally

Requirements: Node ≥ 22, pnpm 11, Foundry 1.8.5, nargo 1.0.0-rc.2 + bb 5.2.1 (circuits only).

```bash
git submodule update --init --recursive && pnpm install
cp .env.example .env    # then fill in Convex and testnet keys
pnpm dev                # http://localhost:3000
```

## Tests

```bash
pnpm --filter @sigilo/core test        # pinned vectors for keys, hashes, trees, one-time accounts, intents
cd packages/circuits && pnpm test      # nargo test + a real proof in Node
cd packages/contracts && forge test    # unit, fuzz, and a real-proof verification
```

End-to-end on Monad testnet (needs `pnpm dev` and the testnet keys in `.env`):

| Script                     | What it proves                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm smoke:payroll`       | Encrypted roster → payout in shuffled pieces → registry root on-chain → worker decrypts payslip, balance matches |
| `pnpm smoke:passport`      | 3 paid months → Income Passport proof → free on-chain check → lender pays $0.10 via MPP → signed attestation     |
| `pnpm smoke:sendhome`      | Pieces sign → unauthenticated relay → AUSD→CTK on Agora → Mom's receipt and balance                              |
| `pnpm smoke:advance`       | Verified check → offer → proof for the vault → advance on-chain → mandate → two payroll runs repay and close it  |
| `pnpm smoke:collect`       | Advanced settings: move every piece to an external account                                                       |
| `pnpm smoke:two-employers` | One account joins two employers; the Income Passport carries over                                                |
| `pnpm e2e:passport`        | The passport flow through the real UI in headless Chromium with a virtual passkey (PRF)                          |
| `pnpm e2e:sendhome`        | Send home through the real UI                                                                                    |
| `pnpm e2e:advance`         | Salary advance through the real UI: lender offer, worker takes it on her phone, payroll repays                   |
| `pnpm e2e:settings`        | Advanced settings through the real UI                                                                            |
| `pnpm e2e:passkey <url>`   | Passkey create / sign-in against any deployment                                                                  |

(Run them from `apps/web`.)

## License

[MIT](LICENSE)
