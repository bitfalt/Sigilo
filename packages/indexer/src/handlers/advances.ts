// AdvanceVault: salary advances repaid from payroll, rolled up into one portfolio per lender
// vault. Vault liquidity comes from the AUSD ledger itself (every transfer in and out), so it
// always equals the vault's AUSD balance.

import { indexer, type Advance, type LenderPortfolio } from "envio";

import { type Context, loadDay, loadStats } from "../lib/stats";

const VAULTS = indexer.chains.monadTestnet.AdvanceVault.addresses;

async function loadPortfolio(context: Context, vault: string): Promise<LenderPortfolio> {
  return (
    (await context.LenderPortfolio.get(vault)) ?? {
      id: vault,
      advancesIssued: 0,
      activeAdvances: 0,
      closedAdvances: 0,
      borrowers: 0,
      repeatBorrowers: 0,
      lent: 0n,
      owedTotal: 0n,
      feesExpected: 0n,
      repaid: 0n,
      outstanding: 0n,
      repaymentRate: 0,
      fundsIn: 0n,
      fundsOut: 0n,
      deposits: 0n,
      withdrawn: 0n,
      liquidity: 0n,
      lastActivityAt: 0,
    }
  );
}

/** Recompute the portfolio's derived fields. */
function settle(p: LenderPortfolio, timestamp: number): LenderPortfolio {
  return {
    ...p,
    repaymentRate: p.owedTotal === 0n ? 0 : Number((p.repaid * 1_000_000n) / p.owedTotal) / 1e6,
    // Repayments arrive as transfers too; the rest of what came in is the lender's money.
    deposits: p.fundsIn - p.repaid,
    liquidity: p.fundsIn - p.fundsOut,
    lastActivityAt: timestamp,
  };
}

const progress = (repaid: bigint, owed: bigint) =>
  owed === 0n ? 1 : Number((repaid * 1_000_000n) / owed) / 1e6;

const advanceId = (vault: string, id: bigint) => `${vault}-${id}`;

indexer.onEvent(
  { contract: "AdvanceVault", event: "AdvanceIssued" },
  async ({ event, context }) => {
    const vault = event.srcAddress;
    const { pseudonym, recipient, amount, owed } = event.params;
    const timestamp = event.block.timestamp;
    const borrowerId = `${vault}-${pseudonym}`;
    const [stats, day, portfolio, borrower, piece] = await Promise.all([
      loadStats(context),
      loadDay(context, timestamp),
      loadPortfolio(context, vault),
      context.Borrower.get(borrowerId),
      context.Piece.get(recipient),
    ]);
    const id = advanceId(vault, event.params.advanceId);

    context.Advance.set({
      id,
      vault_id: vault,
      advanceId: Number(event.params.advanceId),
      borrower_id: borrowerId,
      recipient,
      principal: amount,
      owed,
      fee: owed - amount,
      repaid: 0n,
      remaining: owed,
      progress: 0,
      status: "ACTIVE",
      issuedAt: timestamp,
      issuedTx: event.transaction.hash,
      closedAt: undefined,
      closedTx: undefined,
      repaymentCount: 0,
      repaidBy_id: undefined,
    });
    context.Borrower.set({
      id: borrowerId,
      vault_id: vault,
      pseudonym: pseudonym.toString(),
      advances: (borrower?.advances ?? 0) + 1,
      borrowed: (borrower?.borrowed ?? 0n) + amount,
    });
    // The advance lands in a fresh one-time account: track it like a piece, so spending it
    // together with payroll pieces shows up in the linkage analysis.
    context.Piece.set(
      piece
        ? { ...piece, amount: piece.amount + amount }
        : {
            id: recipient,
            source: "ADVANCE",
            run_id: undefined,
            employer_id: undefined,
            advance_id: id,
            amount,
            receivedAt: timestamp,
            spentAmount: 0n,
            spendCount: 0,
            firstSpentAt: undefined,
            cluster_id: undefined,
            linked: false,
          },
    );
    context.LenderPortfolio.set(
      settle(
        {
          ...portfolio,
          advancesIssued: portfolio.advancesIssued + 1,
          activeAdvances: portfolio.activeAdvances + 1,
          borrowers: portfolio.borrowers + (borrower ? 0 : 1),
          repeatBorrowers: portfolio.repeatBorrowers + (borrower?.advances === 1 ? 1 : 0),
          lent: portfolio.lent + amount,
          owedTotal: portfolio.owedTotal + owed,
          feesExpected: portfolio.feesExpected + (owed - amount),
          outstanding: portfolio.outstanding + owed,
        },
        timestamp,
      ),
    );
    context.DailyActivity.set({
      ...day,
      advancesIssued: day.advancesIssued + 1,
      advancedVolume: day.advancedVolume + amount,
    });
    context.NetworkStats.set({
      ...stats,
      advancesIssued: stats.advancesIssued + 1,
      advancesActive: stats.advancesActive + 1,
      advancedVolume: stats.advancedVolume + amount,
      updatedAt: timestamp,
    });
  },
);

indexer.onEvent(
  { contract: "AdvanceVault", event: "AdvanceRepaid" },
  async ({ event, context }) => {
    const vault = event.srcAddress;
    const { payer, paid, remaining } = event.params;
    const timestamp = event.block.timestamp;
    const id = advanceId(vault, event.params.advanceId);
    const [stats, day, portfolio, advance, employer] = await Promise.all([
      loadStats(context),
      loadDay(context, timestamp),
      loadPortfolio(context, vault),
      context.Advance.getOrThrow(id),
      context.Employer.get(payer),
    ]);
    // The first repayment publicly ties the advance to the company account paying it.
    const firstTie = advance.repaidBy_id === undefined;

    context.Repayment.set({
      id: `${event.transaction.hash}-${event.logIndex}`,
      advance_id: id,
      employer_id: payer,
      amount: paid,
      remaining,
      timestamp,
      txHash: event.transaction.hash,
    });
    const repaid = advance.repaid + paid;
    context.Advance.set({
      ...advance,
      repaid,
      remaining,
      progress: progress(repaid, advance.owed),
      repaymentCount: advance.repaymentCount + 1,
      repaidBy_id: advance.repaidBy_id ?? payer,
    } satisfies Advance);
    context.Employer.set({
      id: payer,
      runs: employer?.runs ?? 0,
      pieces: employer?.pieces ?? 0,
      totalPaid: employer?.totalPaid ?? 0n,
      firstSeenAt: employer?.firstSeenAt ?? timestamp,
      lastRunAt: employer?.lastRunAt,
      advanceRepayments: (employer?.advanceRepayments ?? 0) + 1,
      repaidToLenders: (employer?.repaidToLenders ?? 0n) + paid,
      advancesRepaid: (employer?.advancesRepaid ?? 0) + (firstTie ? 1 : 0),
    });
    context.LenderPortfolio.set(
      settle(
        {
          ...portfolio,
          repaid: portfolio.repaid + paid,
          outstanding: portfolio.outstanding - paid,
        },
        timestamp,
      ),
    );
    context.DailyActivity.set({ ...day, repaidVolume: day.repaidVolume + paid });
    context.NetworkStats.set({
      ...stats,
      repaidVolume: stats.repaidVolume + paid,
      advancesTiedToEmployer: stats.advancesTiedToEmployer + (firstTie ? 1 : 0),
      updatedAt: timestamp,
    });
  },
);

indexer.onEvent(
  { contract: "AdvanceVault", event: "AdvanceClosed" },
  async ({ event, context }) => {
    const vault = event.srcAddress;
    const timestamp = event.block.timestamp;
    const [stats, portfolio, advance] = await Promise.all([
      loadStats(context),
      loadPortfolio(context, vault),
      context.Advance.getOrThrow(advanceId(vault, event.params.advanceId)),
    ]);
    context.Advance.set({
      ...advance,
      status: "CLOSED",
      closedAt: timestamp,
      closedTx: event.transaction.hash,
    });
    context.LenderPortfolio.set(
      settle(
        {
          ...portfolio,
          activeAdvances: portfolio.activeAdvances - 1,
          closedAdvances: portfolio.closedAdvances + 1,
        },
        timestamp,
      ),
    );
    context.NetworkStats.set({
      ...stats,
      advancesActive: stats.advancesActive - 1,
      advancesClosed: stats.advancesClosed + 1,
      updatedAt: timestamp,
    });
  },
);

indexer.onEvent({ contract: "AdvanceVault", event: "Withdrawn" }, async ({ event, context }) => {
  const portfolio = await loadPortfolio(context, event.srcAddress);
  context.LenderPortfolio.set(
    settle(
      { ...portfolio, withdrawn: portfolio.withdrawn + event.params.amount },
      event.block.timestamp,
    ),
  );
});

// Every AUSD transfer into or out of a vault: deposits, repayments, advances paid out and
// withdrawals. Their running sum is the vault's balance.
indexer.onEvent(
  {
    contract: "AUSD",
    event: "Transfer",
    where: { params: [{ to: VAULTS }, { from: VAULTS }] },
  },
  async ({ event, context }) => {
    const { from, to, value } = event.params;
    const timestamp = event.block.timestamp;
    if (VAULTS.includes(to)) {
      const p = await loadPortfolio(context, to);
      context.LenderPortfolio.set(settle({ ...p, fundsIn: p.fundsIn + value }, timestamp));
    }
    if (VAULTS.includes(from)) {
      const p = await loadPortfolio(context, from);
      context.LenderPortfolio.set(settle({ ...p, fundsOut: p.fundsOut + value }, timestamp));
    }
  },
);
