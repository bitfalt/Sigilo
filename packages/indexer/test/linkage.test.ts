// The adversary view: what spending reveals over time. María and José are paid in January and
// February; María spends, José doesn't.

import { createTestIndexer } from "envio";
import { describe, it } from "vitest";

import { account, CHAIN_ID, intent, payment, payroll, txHash, usd } from "./helpers";

const acme = account("acme");
const mom = account("mom");
const piece = (label: string, dollars: number) => ({
  account: account(label),
  amount: usd(dollars),
});

const jan = {
  maria: [piece("m-a", 1000), piece("m-b", 1000), piece("m-c", 200), piece("m-d", 200)],
  jose: [piece("j-a", 1000), piece("j-b", 200), piece("j-c", 5)],
};
const feb = {
  maria: [piece("m-e", 1000), piece("m-f", 1000), piece("m-g", 200), piece("m-h", 200)],
  jose: [piece("j-d", 1000), piece("j-e", 200), piece("j-f", 5)],
};
const [mA, mB, mC, mD] = jan.maria;
const [mE, mF] = feb.maria;
const JAN = txHash("payroll-1");
const FEB = txHash("payroll-4");

/** The partial spends leave remainders in mB and mD; February's payment spends both. */
function history() {
  return [
    payroll({
      step: 1,
      payer: acme,
      pieces: [mC!, jan.jose[0]!, mA!, jan.jose[2]!, mD!, mB!, jan.jose[1]!],
    }),
    // $1,300 home: mA in full, $300 of mB.
    ...payment({
      step: 2,
      kind: "sendHome",
      id: intent("s2"),
      to: mom,
      pulls: [mA!, { account: mB!.account, amount: usd(300) }],
      amountOut: usd(1300) * 10n ** 12n,
    }),
    // $250 to a friend: mC in full, $50 of mD. The adversary sees two unrelated payments.
    ...payment({
      step: 3,
      kind: "collect",
      id: intent("s3"),
      to: account("friend"),
      pulls: [mC!, { account: mD!.account, amount: usd(50) }],
    }),
    payroll({ step: 4, payer: acme, pieces: [...feb.jose, ...feb.maria] }),
    // $2,850 home: both February $1,000s plus the remainders of mB and mD.
    ...payment({
      step: 5,
      kind: "sendHome",
      id: intent("s5"),
      to: account("mom-2"),
      pulls: [
        mE!,
        mF!,
        { account: mB!.account, amount: usd(700) },
        { account: mD!.account, amount: usd(150) },
      ],
      amountOut: usd(2850) * 10n ** 12n,
    }),
  ];
}

describe("linkage", () => {
  it("links the pieces of one payment and nothing else", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN_ID]: { simulate: history().slice(0, 4) } } });

    const spend = await indexer.Spend.getOrThrow(intent("s2"));
    t.expect(spend).toMatchObject({
      kind: "SEND_HOME",
      recipient: mom,
      total: usd(1300),
      inputCount: 2,
      partialInputs: 1,
      runsLinked: 1,
      newlyLinkedPieces: 2,
      cluster_id: intent("s2"),
    });
    t.expect(await indexer.Cluster.getOrThrow(intent("s2"))).toMatchObject({
      active: true,
      size: 2,
      payrollPieces: 2,
      runCount: 1,
      largestExposure: usd(2000),
    });
    t.expect(await indexer.Piece.getOrThrow(mB!.account)).toMatchObject({
      spentAmount: usd(300),
      spendCount: 1,
      linked: true,
    });
    t.expect(await indexer.PayrollRun.getOrThrow(JAN)).toMatchObject({
      piecesSpent: 2,
      linkedPieces: 2,
      unlinkedShare: 5 / 7,
      largestExposure: usd(2000),
    });
  });

  it("merges clusters when a later payment spends remainders from both", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({ chains: { [CHAIN_ID]: { simulate: history() } } });

    // Before February the adversary saw two clusters. The $2,850 payment proves they're one person.
    const merged = await indexer.Cluster.getOrThrow(intent("s2"));
    t.expect(merged).toMatchObject({
      active: true,
      size: 6,
      payrollPieces: 6,
      spendCount: 3,
      volume: usd(1300 + 250 + 2850),
      runCount: 2,
      employerCount: 1,
      includesAdvance: false,
      largestExposure: usd(2400),
    });
    t.expect([...merged.runIds].sort()).toEqual([JAN, FEB].sort());
    t.expect(await indexer.Cluster.getOrThrow(intent("s3"))).toMatchObject({
      active: false,
      mergedInto_id: intent("s2"),
    });
    t.expect(await indexer.Spend.getOrThrow(intent("s3"))).toMatchObject({
      cluster_id: intent("s2"),
    });
    t.expect(await indexer.Spend.getOrThrow(intent("s5"))).toMatchObject({
      inputCount: 4,
      partialInputs: 0,
      runsLinked: 2,
      newlyLinkedPieces: 2,
    });

    // María's whole January pay ($2,400) is now tied to one owner, and $2,000 of February's.
    t.expect(await indexer.Exposure.getOrThrow(`${intent("s2")}-${JAN}`)).toMatchObject({
      pieces: 4,
      amount: usd(2400),
      active: true,
    });
    t.expect(await indexer.Exposure.getOrThrow(`${intent("s2")}-${FEB}`)).toMatchObject({
      pieces: 2,
      amount: usd(2000),
      active: true,
    });
    t.expect(await indexer.Exposure.getOrThrow(`${intent("s3")}-${JAN}`)).toMatchObject({
      active: false,
    });

    t.expect(await indexer.PayrollRun.getOrThrow(JAN)).toMatchObject({
      piecesSpent: 4,
      linkedPieces: 4,
      unlinkedShare: 3 / 7,
      largestExposure: usd(2400),
    });
    t.expect(await indexer.PayrollRun.getOrThrow(FEB)).toMatchObject({
      piecesSpent: 2,
      linkedPieces: 2,
      unlinkedShare: 5 / 7,
      largestExposure: usd(2000),
    });
    t.expect(await indexer.Denomination.getOrThrow(String(usd(1000)))).toMatchObject({
      issued: 6,
      spent: 4,
    });

    // José never spent: none of his pieces can be told apart.
    for (const p of [...jan.jose, ...feb.jose]) {
      t.expect(await indexer.Piece.getOrThrow(p.account)).toMatchObject({
        linked: false,
        spendCount: 0,
      });
    }

    t.expect(await indexer.NetworkStats.getOrThrow("sigilo")).toMatchObject({
      payrollRuns: 2,
      pieces: 14,
      spends: 3,
      sendHomes: 2,
      collects: 1,
      spentVolume: usd(4400),
      sendHomeVolume: usd(4150),
      ctkDelivered: usd(4150) * 10n ** 12n,
      piecesSpent: 6,
      linkedPieces: 6,
      unlinkedShare: 8 / 14,
      clusters: 1,
      largestCluster: 6,
      multiRunClusters: 1,
      multiEmployerClusters: 0,
      reusedDestinations: 0,
    });
  });

  it("doesn't link a piece spent on its own", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN_ID]: {
          simulate: [
            payroll({ step: 1, payer: acme, pieces: [...jan.jose, ...jan.maria] }),
            ...payment({
              step: 2,
              kind: "collect",
              id: intent("j1"),
              to: mom,
              pulls: [jan.jose[1]!],
            }),
            ...payment({
              step: 3,
              kind: "collect",
              id: intent("j2"),
              to: mom,
              pulls: [jan.jose[2]!],
            }),
          ],
        },
      },
    });
    t.expect(await indexer.Piece.getOrThrow(jan.jose[1]!.account)).toMatchObject({
      spendCount: 1,
      linked: false,
    });
    t.expect(await indexer.NetworkStats.getOrThrow("sigilo")).toMatchObject({
      piecesSpent: 2,
      linkedPieces: 0,
      unlinkedShare: 1,
      clusters: 2,
      largestCluster: 1,
      // The same destination twice: a hint, but not proof, that both came from one person.
      reusedDestinations: 1,
    });
    t.expect(await indexer.Destination.getOrThrow(mom)).toMatchObject({
      spends: 2,
      received: usd(205),
    });
  });
});
