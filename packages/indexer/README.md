# Sigilo indexer (Envio HyperIndex)

Indexes Sigilo on Monad testnet (chain 10143) over **HyperSync**, and computes two things from the
public record: Sigilo's numbers (payroll, spending, advances, lender portfolios), and **what a
stranger can learn** from it. Everything it reads is public, so the indexer plays the adversary:
it measures how well each payroll hides who got what, and how much spending gives away.

The web app reads it through GraphQL (`apps/web/src/lib/indexer.ts`):

| Page                                    | What it shows from the indexer                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `/network` (Sigilo in numbers)          | Network totals, every recent payroll piece by piece, sizes paid, linked groups     |
| `/lender` (lender console)              | The vault's portfolio: lent, still owed, repaid, active advances, liquidity        |
| `/record/[tx]` (what the internet sees) | Which of the payroll's pieces were spent, alone or together, and what that reveals |

## What's indexed

| Contract                 | Events                                                         | Notes                                                                                                                     |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `SigiloRegistry`         | `RootPublished`, `EmployerVerificationSet`                     | Registry roots, currently verified employers                                                                              |
| `IncomePassportVerifier` | `PassportVerified`                                             | On-chain attestations (the app verifies off-chain through the paid API, so these are rare)                                |
| `SigiloPay`              | `Dispersed`, `Paid`                                            | `Dispersed` selects the transaction `input`: the pieces only exist in the `disperse(to[], amounts[])` calldata            |
| `AdvanceVault`           | `AdvanceIssued`, `AdvanceRepaid`, `AdvanceClosed`, `Withdrawn` | One portfolio per vault                                                                                                   |
| `AUSD`                   | `Transfer`, filtered on indexed topics                         | Only transfers **into SigiloPay** (each spent piece) and **into or out of a vault** (its ledger); nothing else is fetched |

Two correlations make the data useful:

- **Payout → pieces.** `Dispersed` carries the payer, count and total; the handler decodes the
  transaction input and only trusts it if the transaction called SigiloPay directly and the
  decoded pieces match the event (`src/lib/disperse.ts`).
- **Payment → its pieces.** `collect` / `sendHome` pull every piece with an ERC-3009
  `receiveWithAuthorization`, an AUSD `Transfer(piece → SigiloPay)`, then emit one `Paid`. The
  transfer handler stages the pulls per transaction (`PendingPulls`, `@internal`) and the `Paid`
  handler consumes them (`src/handlers/spending.ts`).

## The model

`schema.graphql` is the reference; amounts are AUSD base units (6 decimals).

- **Facts:** `PayrollRun`, `Piece`, `Spend` + `SpendInput`, `Destination`, `Advance` +
  `Repayment`, `RegistryRoot`, `EmployerVerification`, `PassportAttestation`.
- **Aggregates:** `NetworkStats` (one row, id `sigilo`), `DailyActivity` (per UTC day),
  `Employer` (per company account: runs, total paid, advances it repays), `Denomination` (every
  piece size ever paid, and how many were spent), `RunDenomination` (sizes per payout),
  `LenderPortfolio` (per vault), `Borrower` (per vault and pseudonym).
- **The adversary's view:** `Cluster`, `Exposure`, and the anonymity and linkage fields on
  `PayrollRun` and `NetworkStats`.

### What a stranger can learn

| Measure                                             | Definition                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymity set of a piece                            | The pieces of the same payout with the same amount: the observer can't tell them apart. `PayrollRun.meanAnonymitySet` = Σ count² / N, `largestGroup`, `uniquePieces` (sizes nobody else got), `distinctAmounts`                                                                                         |
| Single-piece payrolls                               | `NetworkStats.singlePieceRuns`: a payout of one piece hides nothing about the amount                                                                                                                                                                                                                    |
| Linkage (`Cluster`)                                 | All inputs of one payment sign the same intent, so they share an owner. Accounts spent together form a cluster; a later payment that spends the remainder of a partially spent piece together with accounts from another cluster merges the two (union-find, smaller into larger; `src/lib/linkage.ts`) |
| `Piece.linked`, `unlinkedShare`                     | A piece is linked once a payment ties it to any other account. `unlinkedShare` = 1 − linked payroll pieces / payroll pieces, per run and network-wide                                                                                                                                                   |
| `Exposure`, `largestExposure`                       | Two or more pieces of one payout in one cluster: that person received at least their sum in it. Spending a whole paycheck in one payment exposes it                                                                                                                                                     |
| `multiRunClusters`, `multiEmployerClusters`         | Clusters that tie pieces from several payrolls (one person, several months) or several company accounts (one person, two employers)                                                                                                                                                                     |
| `reusedDestinations`                                | Destinations that received more than one payment: a hint, not proof, of a common sender                                                                                                                                                                                                                 |
| `advancesTiedToEmployer`, `Employer.advancesRepaid` | Repayments come from the employer's treasury, so each advance is publicly tied to the company that repays it                                                                                                                                                                                            |

What it can't learn: names, who works where, salaries (unless a whole paycheck is spent at once),
which pieces belong together before they're spent, and who borrowed across lenders (each vault
sees its own pseudonym; `Borrower` is per vault).

## Example queries

```graphql
# Network numbers and the most recent payrolls, as /network loads them
query {
  NetworkStats(where: { id: { _eq: "sigilo" } }) {
    payrollRuns
    pieces
    paidVolume
    unlinkedShare
    clusters
    multiRunClusters
    singlePieceRuns
  }
  PayrollRun(order_by: { timestamp: desc }, limit: 10) {
    txHash
    pieceCount
    total
    distinctAmounts
    meanAnonymitySet
    linkedPieces
    largestExposure
  }
}

# One payroll: which pieces were spent, and what spending revealed
query ($tx: String!) {
  PayrollRun(where: { txHash: { _eq: $tx } }) {
    pieceCount
    piecesSpent
    linkedPieces
    unlinkedShare
  }
  Piece(where: { run_id: { _eq: $tx } }) {
    id
    amount
    spendCount
    linked
    cluster_id
  }
  Exposure(where: { run_id: { _eq: $tx }, active: { _eq: true } }) {
    cluster_id
    pieces
    amount
  }
}

# The lender's portfolio
query {
  LenderPortfolio(where: { id: { _eq: "0xdb38a7f37f45934a42f4ddd740d8f69414de7734" } }) {
    lent
    outstanding
    repaid
    repaymentRate
    activeAdvances
    closedAdvances
    liquidity
  }
}

# The largest groups of accounts spending tied together
query {
  Cluster(where: { active: { _eq: true }, size: { _gt: 1 } }, order_by: { size: desc }) {
    size
    spendCount
    runCount
    employerCount
    includesAdvance
    largestExposure
  }
}
```

## Develop

```bash
pnpm install                       # from the repo root
pnpm --filter @sigilo/indexer test        # codegen + handler tests (Vitest, createTestIndexer)
pnpm --filter @sigilo/indexer typecheck
cd packages/indexer && pnpm dev    # local indexer + Hasura on :8080; needs Docker and ENVIO_API_TOKEN (.env)
```

The handler tests (`test/*.test.ts`) feed simulated payouts, payments and advances through the
real handlers: anonymity metrics, partial pieces merging clusters across months, an advance spent
with payroll pieces, the lender portfolio, the registry.

### Check it against the real chain

```bash
pnpm snapshot:testnet   # ~7 min on the public RPC: every Sigilo log, payout calldata, on-chain state
pnpm test:testnet       # replays it through the handlers and compares with the chain
```

The snapshot needs no HyperSync token or Docker: it reads logs over JSON-RPC in 100-block windows
and then records the vault's AUSD balance, every advance, the registry root count and the AUSD
balance of every piece. The replay checks that every payout decoded, every payment's pieces add up
to its total, the vault's indexed liquidity equals its balance, each advance matches the contract,
every piece holds exactly what it received minus what it spent, and the linkage stats agree with
the clusters. Snapshot at block 70,198,636 (2026-10-11): 38 payrolls (31 of a single piece),
68 pieces, $799.45 paid; 6 payments, 3 of which moved a whole 5-piece paycheck at once and so
linked 15 pieces into 3 groups; 2 advances, vault liquidity $997.89. All checks pass.

## Deploy (Envio Cloud)

Connected to this repo with Indexer Directory `./packages/indexer`, config file `config.yaml`,
release branch `envio`. Each push to `envio` builds and re-indexes from the start block, and the
previous deployment serves queries until the new one is synced:

```bash
git push origin main:envio
```

Envio Cloud only uploads this directory, ignores lockfiles (so dependencies are pinned exactly in
`package.json`) and runs codegen itself. Copy the deployment's GraphQL URL into the web app's
`NEXT_PUBLIC_ENVIO_GRAPHQL_URL`.

## Notes

- `address_format: lowercase`: every id that embeds an account is lowercase; the app lowercases
  before querying.
- A `where` callback only sees its own contract's addresses, so the AUSD filters read SigiloPay's
  and the vault's from `indexer.chains.monadTestnet` at load time (one source of truth:
  `config.yaml`). The handlers also check the addresses themselves.
- Handlers run twice (a parallel preload pass whose writes are ignored, then in on-chain order).
  They make no external calls, so nothing here needs `context.isPreload`.
