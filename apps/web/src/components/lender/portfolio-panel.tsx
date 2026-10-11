"use client";

// The lender's advance portfolio, live from Sigilo's Envio indexer (packages/indexer,
// LenderPortfolio): what the vault lent, what's still owed, what payroll has repaid, and what's
// left to lend. Hidden when the indexer isn't configured or doesn't answer.

import { SIGILO_TESTNET } from "@sigilo/core/deployments";
import { type ReactNode, useEffect, useState } from "react";

import { count, percent, plural, usd } from "@/components/network/format";
import { fetchLenderPortfolio, indexerConfigured, type LenderPortfolio } from "@/lib/indexer";

const REFRESH_MS = 30_000;

type State = { portfolio: LenderPortfolio | null } | "loading" | "unavailable";

export function PortfolioPanel({ vault = SIGILO_TESTNET.advanceVault }: { vault?: string }) {
  const [state, setState] = useState<State>(indexerConfigured ? "loading" : "unavailable");

  useEffect(() => {
    if (!indexerConfigured) return;
    let cancelled = false;
    const load = async () => {
      const data = await fetchLenderPortfolio(vault);
      if (cancelled) return;
      setState((prev) => data ?? (typeof prev === "object" ? prev : "unavailable"));
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [vault]);

  if (state === "unavailable") return null;

  return (
    <section aria-labelledby="portfolio" className="em-slip flex flex-col gap-5 p-6 sm:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="portfolio" className="font-wide text-xl">
          Your advances
        </h2>
        <p className="text-muted-foreground text-sm">Live from the public record</p>
      </div>
      {state === "loading" ? (
        <p className="text-muted-foreground text-sm" role="status">
          Live numbers are loading…
        </p>
      ) : state.portfolio === null || state.portfolio.advancesIssued === 0 ? (
        <p className="text-muted-foreground">
          No advances yet. Offer one after an applicant&apos;s income is verified.
          {state.portfolio && state.portfolio.liquidity > 0n
            ? ` ${usd(state.portfolio.liquidity)} is ready to lend.`
            : ""}
        </p>
      ) : (
        <Figures p={state.portfolio} />
      )}
    </section>
  );
}

function Figures({ p }: { p: LenderPortfolio }) {
  const owedTotal = p.owedTotal === 0n ? 1n : p.owedTotal;
  return (
    <>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5">
        <Figure term="Lent" value={usd(p.lent)}>
          in {plural(p.advancesIssued, "advance")}
        </Figure>
        <Figure term="Still owed" value={usd(p.outstanding)}>
          fee included
        </Figure>
        <Figure term="Repaid" value={usd(p.repaid)}>
          straight from payroll
        </Figure>
        <Figure term="Active advances" value={count(p.activeAdvances)}>
          {count(p.closedAdvances)} repaid in full
        </Figure>
        <Figure term="Available to lend" value={usd(p.liquidity)}>
          {p.repeatBorrowers > 0
            ? `${plural(p.repeatBorrowers, "applicant")} came back`
            : `${plural(p.borrowers, "applicant")} so far`}
        </Figure>
      </dl>
      <div className="flex flex-col gap-2">
        <div
          className="bg-secondary h-2 overflow-hidden rounded-full"
          role="progressbar"
          aria-label="Repaid so far"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(p.repaymentRate * 100)}
        >
          <div
            className="bg-primary h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${Number((p.repaid * 10_000n) / owedTotal) / 100}%` }}
          />
        </div>
        <p className="text-muted-foreground text-sm">
          {percent(p.repaymentRate)} of everything owed has been repaid.
        </p>
      </div>
    </>
  );
}

function Figure({ term, value, children }: { term: string; value: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-sm">{term}</dt>
      <dd className="font-wide text-2xl tabular-nums">{value}</dd>
      <dd className="text-muted-foreground text-sm">{children}</dd>
    </div>
  );
}
