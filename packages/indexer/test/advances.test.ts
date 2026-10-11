import { createTestIndexer } from "envio";
import { describe, it } from "vitest";

import {
  account,
  at,
  ausdTransfer,
  CHAIN_ID,
  event,
  intent,
  payment,
  payroll,
  type SimulateItem,
  usd,
  VAULT,
} from "./helpers";

const lender = account("fondo-quincena");
const acme = account("acme");
const recipient = account("advance-1");
const pseudonym = 1234567890123456789012345678901234567890n;

const vault = VAULT as `0x${string}`;
const advanceEvent = (step: number, name: string, params: Record<string, unknown>) =>
  event("AdvanceVault", name, step, params, vault);

function history(): SimulateItem[] {
  return [
    // The lender funds the vault with a plain AUSD transfer.
    ausdTransfer({ step: 1, from: lender, to: vault, value: usd(1000) }),
    // Advance 1: $300, 2% fee.
    advanceEvent(2, "AdvanceIssued", {
      advanceId: 1n,
      pseudonym,
      recipient,
      amount: usd(300),
      owed: usd(306),
    }),
    ausdTransfer({ step: 2, from: vault, to: recipient, value: usd(300), label: "advance-2" }),
    // Two payroll deductions from Acme's treasury close it.
    advanceEvent(3, "AdvanceRepaid", {
      advanceId: 1n,
      payer: acme,
      paid: usd(153),
      remaining: usd(153),
    }),
    ausdTransfer({ step: 3, from: acme, to: vault, value: usd(153), label: "advance-3" }),
    advanceEvent(4, "AdvanceRepaid", { advanceId: 1n, payer: acme, paid: usd(153), remaining: 0n }),
    advanceEvent(4, "AdvanceClosed", { advanceId: 1n }),
    ausdTransfer({ step: 4, from: acme, to: vault, value: usd(153), label: "advance-4" }),
    // Same person, second advance: the vault sees a repeat borrower (same pseudonym).
    advanceEvent(5, "AdvanceIssued", {
      advanceId: 2n,
      pseudonym,
      recipient: account("advance-2"),
      amount: usd(200),
      owed: usd(204),
    }),
    ausdTransfer({
      step: 5,
      from: vault,
      to: account("advance-2"),
      value: usd(200),
      label: "advance-5",
    }),
    advanceEvent(6, "Withdrawn", { to: lender, amount: usd(100) }),
    ausdTransfer({ step: 6, from: vault, to: lender, value: usd(100), label: "withdraw" }),
  ];
}

describe("salary advances", () => {
  it("rolls advances up into the lender's portfolio", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN_ID]: { simulate: history() } } });

    t.expect(await indexer.LenderPortfolio.getOrThrow(vault)).toMatchObject({
      advancesIssued: 2,
      activeAdvances: 1,
      closedAdvances: 1,
      borrowers: 1,
      repeatBorrowers: 1,
      lent: usd(500),
      owedTotal: usd(510),
      feesExpected: usd(10),
      repaid: usd(306),
      outstanding: usd(204),
      repaymentRate: 0.6,
      fundsIn: usd(1306),
      fundsOut: usd(600),
      deposits: usd(1000),
      withdrawn: usd(100),
      // = the vault's AUSD balance
      liquidity: usd(706),
    });

    t.expect(await indexer.Advance.getOrThrow(`${vault}-1`)).toMatchObject({
      advanceId: 1,
      recipient,
      principal: usd(300),
      owed: usd(306),
      fee: usd(6),
      repaid: usd(306),
      remaining: 0n,
      progress: 1,
      status: "CLOSED",
      repaymentCount: 2,
      repaidBy_id: acme,
    });
    t.expect(await indexer.Advance.getOrThrow(`${vault}-2`)).toMatchObject({
      status: "ACTIVE",
      progress: 0,
      repaidBy_id: undefined,
    });
    t.expect(await indexer.Borrower.getOrThrow(`${vault}-${pseudonym}`)).toMatchObject({
      advances: 2,
      borrowed: usd(500),
    });
    t.expect(await indexer.Employer.getOrThrow(acme)).toMatchObject({
      runs: 0,
      advanceRepayments: 2,
      repaidToLenders: usd(306),
      advancesRepaid: 1,
    });
    t.expect(await indexer.NetworkStats.getOrThrow("sigilo")).toMatchObject({
      employers: 0,
      advancesIssued: 2,
      advancesActive: 1,
      advancesClosed: 1,
      advancedVolume: usd(500),
      repaidVolume: usd(306),
      advancesTiedToEmployer: 1,
    });
  });

  it("links an advance to payroll pieces spent with it", async (t) => {
    const indexer = createTestIndexer();
    const pay = { account: account("m-a"), amount: usd(1000) };
    await indexer.process({
      chains: {
        [CHAIN_ID]: {
          simulate: [
            payroll({
              step: 1,
              payer: acme,
              pieces: [pay, { account: account("j-a"), amount: usd(1000) }],
            }),
            advanceEvent(2, "AdvanceIssued", {
              advanceId: 1n,
              pseudonym,
              recipient,
              amount: usd(300),
              owed: usd(306),
            }),
            ...payment({
              step: 3,
              kind: "sendHome",
              id: intent("home"),
              to: account("mom"),
              pulls: [pay, { account: recipient, amount: usd(300) }],
            }),
          ],
        },
      },
    });
    t.expect(await indexer.Piece.getOrThrow(recipient)).toMatchObject({
      source: "ADVANCE",
      advance_id: `${vault}-1`,
      linked: true,
    });
    t.expect(await indexer.Cluster.getOrThrow(intent("home"))).toMatchObject({
      size: 2,
      payrollPieces: 1,
      includesAdvance: true,
    });
  });
});
