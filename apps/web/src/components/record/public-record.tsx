"use client";

// "What the internet sees" (SPEC.md §13): everything a stranger can read about one payroll payment,
// straight from the public record. A company account paid N same-sized pieces to N brand-new
// accounts; nothing says which pieces belong to whom. Shown next to a worker's phone in the demo.

import { SIGILO_TESTNET } from "@sigilo/core/deployments";
import { useEffect, useState } from "react";
import { type Address, decodeFunctionData, type Hex, parseAbi } from "viem";

import { AppShell, Perforation } from "@/components/app/app-shell";
import { plural } from "@/components/network/format";
import {
  PIECE_STATE_COPY,
  PieceLegend,
  PieceMark,
  type PieceState,
} from "@/components/network/piece-marks";
import { publicClient } from "@/lib/chain";
import { EXPLORER_URL } from "@/lib/config";
import { fetchRunInsight, indexerConfigured, type RunInsight } from "@/lib/indexer";
import { formatUsd } from "@/lib/wallet";

const disperseAbi = parseAbi(["function disperse(address[] to, uint256[] amounts)"]);

interface Record {
  from: Address;
  at: Date;
  pieces: { to: Address; amount: bigint }[];
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function PublicRecord({ tx }: { tx: string }) {
  const valid = /^0x[0-9a-fA-F]{64}$/.test(tx);
  const [loaded, setRecord] = useState<Record | null | "missing">(null);
  const record = valid ? loaded : "missing";
  // What the indexer learned about this payroll since payday (null: not available).
  const [insight, setInsight] = useState<RunInsight | null>(null);

  useEffect(() => {
    if (!valid || !indexerConfigured) return;
    let cancelled = false;
    fetchRunInsight(tx).then((data) => {
      if (!cancelled) setInsight(data ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [tx, valid]);

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    (async () => {
      try {
        const t = await publicClient.getTransaction({ hash: tx as Hex });
        if (t.to?.toLowerCase() !== SIGILO_TESTNET.sigiloPay.toLowerCase()) throw new Error();
        const { functionName, args } = decodeFunctionData({ abi: disperseAbi, data: t.input });
        if (functionName !== "disperse") throw new Error();
        const block = await publicClient.getBlock({ blockNumber: t.blockNumber! });
        const [to, amounts] = args;
        if (!cancelled) {
          setRecord({
            from: t.from,
            at: new Date(Number(block.timestamp) * 1000),
            pieces: to.map((a, i) => ({ to: a, amount: amounts[i]! })),
          });
        }
      } catch {
        if (!cancelled) setRecord("missing");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tx, valid]);

  if (record === null) {
    return (
      <AppShell wide>
        <p className="text-muted-foreground py-24 text-center">Reading the public record…</p>
      </AppShell>
    );
  }
  if (record === "missing") {
    return (
      <AppShell wide>
        <p className="text-muted-foreground py-24 text-center">
          This isn&apos;t a Sigilo payroll payment.
        </p>
      </AppShell>
    );
  }

  const total = record.pieces.reduce((s, p) => s + p.amount, 0n);
  const sizes = new Set(record.pieces.map((p) => p.amount.toString())).size;
  const stateOf = new Map<string, PieceState>(
    insight?.pieces.map((p) => [
      p.account,
      p.linked ? "linked" : p.spendCount > 0 ? "spent" : "hidden",
    ]) ?? [],
  );

  return (
    <AppShell wide>
      <div className="flex flex-col gap-8 pt-4 pb-12">
        <header className="flex max-w-3xl flex-col gap-3">
          <p className="text-muted-foreground text-[0.9375rem]">Public record</p>
          <h1 className="font-display text-[2.5rem] leading-[1.02] text-balance sm:text-6xl">
            What the internet sees
          </h1>
          <p className="text-muted-foreground text-[1.0625rem] leading-relaxed">
            Anyone can look up this payroll. On{" "}
            {record.at.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}, a
            company account ({short(record.from)}) paid {formatUsd(total)} in {record.pieces.length}{" "}
            payments of {sizes} different sizes, each to an account that had never been used before.
          </p>
        </header>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
          <section className="bg-card rounded-md p-2 shadow-[0_18px_40px_-26px_rgba(15,42,32,0.5)] sm:p-4">
            <ol className="divide-foreground/10 divide-y">
              {record.pieces.map((p, i) => {
                const state = stateOf.get(p.to.toLowerCase());
                return (
                  <li
                    key={`${p.to}-${i}`}
                    title={state && PIECE_STATE_COPY[state]}
                    className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 px-3 py-2.5 text-sm tabular-nums"
                  >
                    <span className="text-muted-foreground">{i + 1}</span>
                    <span className="flex min-w-0 items-center gap-2.5">
                      {state && <PieceMark state={state} />}
                      <span className="truncate">to a new account {short(p.to)}</span>
                    </span>
                    <span className="font-semibold">{formatUsd(p.amount)}</span>
                  </li>
                );
              })}
            </ol>
          </section>

          <aside className="flex flex-col gap-5 lg:sticky lg:top-8">
            <div className="bg-foreground text-background rounded-md p-6">
              <p className="font-wide text-2xl leading-tight">Who got which payment?</p>
              <p className="mt-3 text-[1.0625rem] leading-relaxed opacity-85">
                There&apos;s no way to tell. Every payment goes to a brand-new account, everyone is
                paid in the same few sizes, and the list is shuffled. Only each person&apos;s phone
                knows which ones are theirs, and it shows them one balance.
              </p>
            </div>
            <Perforation />
            <ul className="text-muted-foreground flex flex-col gap-2 text-sm">
              <li>Visible to anyone: that this company paid, the total, and when.</li>
              <li>
                {insight && (insight.run.largestExposure > 0n || insight.run.pieceCount === 1)
                  ? "Never visible: who got paid."
                  : "Never visible: who got paid, or how much any one person earns."}
              </li>
            </ul>
            {insight && <SincePayday insight={insight} />}
            <a
              href={`${EXPLORER_URL}/tx/${tx}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-semibold underline underline-offset-4"
            >
              Check it yourself on the Monad explorer
            </a>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

function spentSentence(spent: number, total: number): string {
  if (total === 1)
    return spent === 0 ? "This payment hasn't been spent yet." : "It has been spent.";
  if (spent === 0) return `None of these ${total} payments has been spent yet.`;
  return `${spent} of these ${total} payments ${spent === 1 ? "has" : "have"} been spent.`;
}

function linkSentence(run: RunInsight["run"]): string {
  const n = run.linkedPieces;
  const were = n === 1 ? "One was" : `${n} were`;
  if (run.piecesSpent === 0) return "";
  if (n > 0 && run.largestExposure > 0n) {
    return `${were} spent together with others, which tells anyone they share an owner: at least ${formatUsd(run.largestExposure)} of this payroll went to one person.`;
  }
  if (n > 0) {
    return `${were} spent together with money from elsewhere, which ties ${n === 1 ? "it" : "each"} to that money's owner.`;
  }
  return run.pieceCount === 1
    ? "On its own, so it isn't tied to anything else."
    : "None was spent together with another, so none can be tied to an owner.";
}

/** What spending revealed about this payroll since it was paid (from the indexer). */
function SincePayday({ insight }: { insight: RunInsight }) {
  const { run } = insight;
  // The anonymity set counts the piece itself.
  const others = Math.max(0, run.meanAnonymitySet - 1).toLocaleString("en-US", {
    maximumFractionDigits: 1,
  });
  return (
    <section className="flex flex-col gap-3" aria-labelledby="since-payday">
      <Perforation />
      <h2 id="since-payday" className="font-wide text-lg">
        Since payday
      </h2>
      <p className="text-[0.9375rem] leading-relaxed">
        {spentSentence(run.piecesSpent, run.pieceCount)} {linkSentence(run)}
      </p>
      <p className="text-muted-foreground text-[0.9375rem] leading-relaxed">
        {run.pieceCount === 1
          ? "A payroll of one payment hides nothing about the amount: whoever got it, their whole pay for this run is public."
          : run.distinctAmounts === run.pieceCount
            ? "On payday no two payments had the same size, so each one stood out."
            : `On payday each payment looked like ${others} others of its size, on average. ${
                run.uniquePieces === 0
                  ? "None was the only one of its size."
                  : run.uniquePieces === 1
                    ? "One was the only one of its size."
                    : `${plural(run.uniquePieces, "payment")} were the only ones of their size.`
              }`}
      </p>
      <PieceLegend className="text-muted-foreground" />
      <p className="text-muted-foreground text-xs">Live from the public record.</p>
    </section>
  );
}
