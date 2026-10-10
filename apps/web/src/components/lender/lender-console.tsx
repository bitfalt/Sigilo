"use client";

// Demo lender console (SPEC.md F5–F6): Fondo Quincena opens an income check, sends the link or QR
// to the applicant, and once the Income Passport arrives pays Sigilo $0.10 (MPP) to verify it.
// The lender's key never reaches the browser: /api/lender/verify pays from the server.

import { DEMO_ADVANCE_TERMS, maxAdvance } from "@sigilo/core/advance";
import { DEMO_LENDER, VERIFY_PRICE_USD } from "@sigilo/core/verify";
import { cn } from "cn";
import { useMutation, useQuery } from "convex/react";
import { Check, Copy, Share2, X } from "lucide-react";
import QRCode from "qrcode";
import { type FormEvent, useEffect, useState, useSyncExternalStore } from "react";

import { AppShell, Perforation } from "@/components/app/app-shell";
import { primaryPill, secondaryPill } from "@/components/employer/parts";
import { SealMark } from "@/components/landing/seal-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EXPLORER_URL } from "@/lib/config";
import { errorMessage } from "@/lib/errors";
import { periodLabel } from "@/lib/periods";
import { formatAmount } from "@/lib/wallet";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

// ------------------------------------------------------------------ checks opened in this browser

const STORE_KEY = "sigilo.lender.checks";
const listeners = new Set<() => void>();
let cache: string | null | undefined;

function readChecks(): string {
  if (cache === undefined) {
    try {
      cache = localStorage.getItem(STORE_KEY);
    } catch {
      cache = null;
    }
  }
  return cache ?? "[]";
}

function addCheck(id: string) {
  const next = JSON.stringify([id, ...(JSON.parse(readChecks()) as string[])].slice(0, 20));
  cache = next;
  try {
    localStorage.setItem(STORE_KEY, next);
  } catch {
    // Private mode: the list lasts for this tab.
  }
  listeners.forEach((l) => l());
}

function useChecks(): string[] {
  const raw = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    readChecks,
    () => "[]",
  );
  return JSON.parse(raw) as string[];
}

// ------------------------------------------------------------------ console

export function LenderConsole() {
  const checks = useChecks();
  const [selected, setSelected] = useState<string | null>(null);
  const current = selected ?? checks[0] ?? null;

  return (
    <AppShell wide>
      <div className="em-console flex flex-col gap-8 pt-4 pb-8">
        <header className="flex flex-col gap-2">
          <h1 className="font-display text-[2.75rem] leading-none sm:text-6xl">
            {DEMO_LENDER.name}
          </h1>
          <p className="text-muted-foreground max-w-[52ch] text-[1.0625rem]">
            Confirm an applicant&apos;s income in a minute, without asking for payslips. Powered by
            Sigilo Income Passports.
          </p>
        </header>
        <Perforation />

        <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
          <div className="flex flex-col gap-8">
            <NewCheck onCreated={(id) => setSelected(id)} />
            {checks.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="font-wide text-lg">Recent checks</h2>
                <ul className="em-slip divide-border divide-y">
                  {checks.map((id) => (
                    <CheckRow
                      key={id}
                      id={id}
                      active={id === current}
                      onSelect={() => setSelected(id)}
                    />
                  ))}
                </ul>
              </section>
            )}
          </div>
          {current ? <CheckDetail key={current} id={current} /> : <EmptyDetail />}
        </div>
      </div>
    </AppShell>
  );
}

function NewCheck({ onCreated }: { onCreated(id: string): void }) {
  const create = useMutation(api.requests.create);
  const [amount, setAmount] = useState("1500");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dollars = Number(amount);
  const valid = Number.isFinite(dollars) && dollars >= 1 && dollars <= 100_000;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = await create({ thresholdCents: Math.round(dollars * 100) });
      addCheck(id);
      onCreated(id);
    } catch (err) {
      setError(errorMessage(err, "Couldn't create the check. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="em-slip flex flex-col gap-4 p-6">
      <h2 className="font-wide text-xl">New income check</h2>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Minimum monthly income (USD)
        <div className="relative">
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2">
            $
          </span>
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            className="h-11 pl-7 text-base"
          />
        </div>
      </label>
      <p className="text-muted-foreground text-sm">
        For each of the last 3 months, from an employer verified by Sigilo.
      </p>
      <Button type="submit" disabled={!valid || busy} className={primaryPill}>
        {busy ? "Creating…" : "Create income check"}
      </Button>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </form>
  );
}

const STATUS_COPY = {
  open: "Waiting for the applicant",
  submitted: "Ready to verify",
  verified: "Verified",
  rejected: "Not verified",
  expired: "Expired",
} as const;

function CheckRow({ id, active, onSelect }: { id: string; active: boolean; onSelect(): void }) {
  const check = useQuery(api.requests.get, { request: id });
  if (check === null) return null;
  return (
    <li>
      <button
        onClick={onSelect}
        aria-current={active}
        className={cn(
          "focus-visible:ring-ring/50 flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left outline-none focus-visible:ring-3",
          active && "bg-secondary/60",
        )}
      >
        <span>
          <span className="block font-semibold">
            {check ? `${formatAmount(check.thresholdCents)} a month` : "…"}
          </span>
          <span className="text-muted-foreground text-sm">
            {check ? new Date(check._creationTime).toLocaleString() : ""}
          </span>
        </span>
        {check && <StatusMark status={check.status} />}
      </button>
    </li>
  );
}

function StatusMark({ status }: { status: keyof typeof STATUS_COPY }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-md border-[1.5px] px-2 py-0.5 text-[0.8rem] font-semibold",
        status === "verified" && "border-primary text-primary bg-[#f4f6ff]",
        status === "submitted" && "border-foreground text-foreground",
        (status === "open" || status === "expired" || status === "rejected") &&
          "border-muted-foreground/40 text-muted-foreground border-dashed",
      )}
    >
      {STATUS_COPY[status]}
    </span>
  );
}

function EmptyDetail() {
  return (
    <section className="border-muted-foreground/35 flex min-h-80 flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed p-8 text-center">
      <SealMark className="text-foreground/60 size-10" />
      <p className="font-wide text-lg">No income checks yet</p>
      <p className="text-muted-foreground max-w-[34ch] text-sm">
        Create one and send the link to your applicant. Their answer shows up here.
      </p>
    </section>
  );
}

// ------------------------------------------------------------------ one check

function CheckDetail({ id }: { id: string }) {
  const check = useQuery(api.requests.get, { request: id });
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch("/api/lender/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Verification didn't go through. Try again.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification didn't go through. Try again.");
    } finally {
      setVerifying(false);
    }
  }

  if (!check) {
    return <section className="em-slip min-h-80 p-8" aria-busy="true" />;
  }
  const amount = formatAmount(check.thresholdCents);

  return (
    <section className="em-slip flex flex-col gap-6 p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-sm">Income check</p>
          <h2 className="font-wide text-2xl">
            At least {amount} a month, last {check.months} months
          </h2>
        </div>
        <StatusMark status={check.status} />
      </div>

      {check.status === "open" && <ShareCheck id={id} />}

      {check.status === "submitted" && (
        <div className="flex flex-col gap-4">
          <p className="text-[1.0625rem]">
            The applicant sent their Income Passport. Sigilo checks it and signs the result.
          </p>
          <Button onClick={verify} disabled={verifying} className={cn(primaryPill, "self-start")}>
            {verifying
              ? `Paying $${VERIFY_PRICE_USD} and verifying…`
              : `Verify for $${VERIFY_PRICE_USD}`}
          </Button>
          <p className="text-muted-foreground text-sm">
            Paid per check in digital dollars, straight from your Fondo Quincena account.
          </p>
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
      )}

      {check.result && (check.status === "verified" || check.status === "rejected") && (
        <VerifiedResult
          valid={check.result.valid}
          amount={amount}
          months={check.result.months}
          firstPeriod={check.result.firstPeriod}
          pseudonym={check.result.pseudonym}
          paymentReference={check.result.paymentReference}
        />
      )}

      {check.status === "verified" && check.result?.valid && (
        <AdvancePanel
          request={check._id}
          thresholdCents={check.thresholdCents}
          offer={check.offer}
          advance={check.advance}
        />
      )}

      {check.status === "expired" && (
        <p className="text-muted-foreground">
          The applicant didn&apos;t answer in time. Create a new check to ask again.
        </p>
      )}
    </section>
  );
}

function ShareCheck({ id }: { id: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/v/${id}`;

  useEffect(() => {
    if (!url) return;
    QRCode.toString(url, {
      type: "svg",
      margin: 0,
      errorCorrectionLevel: "M",
      color: { dark: "#0f2a20", light: "#0000" },
    }).then(setSvg, () => setSvg(null));
  }, [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function share() {
    try {
      await navigator.share({ title: `${DEMO_LENDER.name} income check`, url });
    } catch {
      // Dismissed.
    }
  }

  return (
    <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-center">
      <div
        role="img"
        aria-label="QR code for the income check link"
        className="bg-background size-44 rounded-md p-3 [&_svg]:h-full [&_svg]:w-full"
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
      <div className="flex flex-col gap-3">
        <p className="text-[1.0625rem]">
          Send this link to the applicant, or let them scan the code with their phone.
        </p>
        <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="h-10" />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={copy} className={secondaryPill}>
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          {typeof navigator !== "undefined" && "share" in navigator && (
            <Button variant="outline" onClick={share} className={secondaryPill}>
              <Share2 aria-hidden="true" />
              Share
            </Button>
          )}
        </div>
        <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
          <span className="bg-primary size-2 animate-pulse rounded-full motion-reduce:animate-none" />
          Waiting for the applicant…
        </p>
      </div>
    </div>
  );
}

function VerifiedResult(props: {
  valid: boolean;
  amount: string;
  months: number;
  firstPeriod: number;
  pseudonym: string;
  paymentReference?: string;
}) {
  const { valid, amount, months, firstPeriod, pseudonym, paymentReference } = props;
  const range = `${periodLabel(firstPeriod)} to ${periodLabel(firstPeriod + months - 1)}`;
  const receipt = paymentReference ? `${EXPLORER_URL}/tx/${paymentReference}` : null;

  if (!valid) {
    return (
      <p className="text-destructive text-[1.0625rem]">
        This Income Passport didn&apos;t check out. Don&apos;t rely on it.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="em-stamp em-stamp-in text-primary self-start bg-[#f4f6ff] px-5 py-3.5">
        <span className="font-wide flex items-center gap-2 text-2xl leading-none">
          <SealMark className="size-6" />
          Income verified
        </span>
        <span className="mt-1.5 text-sm">
          Paid ${VERIFY_PRICE_USD} to Sigilo
          {receipt && (
            <>
              {" "}
              <a href={receipt} target="_blank" rel="noreferrer" className="underline">
                View receipt
              </a>
            </>
          )}
        </span>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="font-wide text-base">What you know</p>
          <ul className="mt-2 flex flex-col gap-2 text-[0.9375rem]">
            <Fact ok>Earns at least {amount} a month</Fact>
            <Fact ok>Every month from {range}</Fact>
            <Fact ok>Paid by an employer verified by Sigilo</Fact>
          </ul>
        </div>
        <div>
          <p className="font-wide text-base">What you didn&apos;t need to see</p>
          <ul className="mt-2 flex flex-col gap-2 text-[0.9375rem]">
            <Fact>The employer&apos;s name</Fact>
            <Fact>The exact salary</Fact>
            <Fact>Payslips or bank statements</Fact>
          </ul>
        </div>
      </div>

      <div className="bg-background/70 rounded-md p-4">
        <p className="text-sm font-semibold">Applicant ID</p>
        <p className="mt-1 text-sm break-all tabular-nums">{pseudonym}</p>
        <p className="text-muted-foreground mt-2 text-sm">
          The same person always gets this ID with {DEMO_LENDER.name}, and a different one with any
          other lender.
        </p>
      </div>
    </div>
  );
}

function Fact({ ok = false, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <Check aria-hidden="true" className="text-primary mt-0.5 size-4 shrink-0" />
      ) : (
        <X aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 shrink-0" />
      )}
      <span>{children}</span>
    </li>
  );
}

// ------------------------------------------------------------------ salary advance (F7)

function AdvancePanel({
  request,
  thresholdCents,
  offer,
  advance,
}: {
  request: Id<"verificationRequests">;
  thresholdCents: number;
  offer?: { amountCents: number; installments: number; feeBps: number };
  advance?: {
    amount: string;
    owed: string;
    txHash: string;
    status: "active" | "closed";
    installments?: number;
    paidInstallments?: number;
    remainingCents?: number;
  };
}) {
  const make = useMutation(api.advances.offer);
  const cap = Number(maxAdvance(BigInt(thresholdCents), DEMO_ADVANCE_TERMS.maxRatioBps) / 10_000n);
  const [amount, setAmount] = useState(String(cap / 100));
  const [installments, setInstallments] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cents = Math.round(Number(amount) * 100);
  const valid = Number.isFinite(cents) && cents >= 100 && cents <= cap;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await make({ request, amountCents: cents, installments });
    } catch (err) {
      setError(errorMessage(err, "Couldn't send the offer. Try again."));
    } finally {
      setBusy(false);
    }
  }

  if (advance) {
    const owedCents = Number(BigInt(advance.owed) / 10_000n);
    const repaid = advance.remainingCents === undefined ? 0 : owedCents - advance.remainingCents;
    return (
      <div className="border-foreground/15 flex flex-col gap-3 border-t pt-6">
        <p className="font-wide text-lg">Salary advance</p>
        <p className="text-[1.0625rem]">
          Sent {formatAmount(Number(BigInt(advance.amount) / 10_000n))}.{" "}
          {advance.status === "closed"
            ? "Fully repaid from payroll."
            : `Repaid ${formatAmount(repaid)} of ${formatAmount(owedCents)} from payroll.`}
        </p>
        <div className="bg-secondary h-2 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
            style={{ width: `${Math.min(100, (repaid / owedCents) * 100)}%` }}
          />
        </div>
        <p className="text-muted-foreground text-sm">
          {advance.installments
            ? `${advance.paidInstallments ?? 0} of ${advance.installments} paychecks deducted by the employer.`
            : "Waiting for the applicant to set up the payroll deduction."}{" "}
          <a
            href={`${EXPLORER_URL}/tx/${advance.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            View payment
          </a>
        </p>
      </div>
    );
  }

  if (offer) {
    return (
      <div className="border-foreground/15 flex flex-col gap-2 border-t pt-6">
        <p className="font-wide text-lg">Salary advance</p>
        <p className="text-[1.0625rem]">
          You offered {formatAmount(offer.amountCents)}, repaid from the next{" "}
          {offer.installments === 1 ? "paycheck" : `${offer.installments} paychecks`}.
        </p>
        <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
          <span className="bg-primary size-2 animate-pulse rounded-full motion-reduce:animate-none" />
          Waiting for the applicant to accept…
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="border-foreground/15 flex flex-col gap-4 border-t pt-6">
      <div>
        <p className="font-wide text-lg">Offer a salary advance</p>
        <p className="text-muted-foreground text-sm">
          Up to {formatAmount(cap)} ({DEMO_ADVANCE_TERMS.maxRatioBps / 100}% of the verified monthly
          income), {DEMO_ADVANCE_TERMS.feeBps / 100}% fee, repaid by the employer straight from
          payroll.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Amount (USD)
          <Input
            id="offer-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            className="h-11 w-36 text-base"
          />
        </label>
        <fieldset className="flex flex-col gap-1.5 text-sm font-semibold">
          <legend className="mb-1.5">Paychecks</legend>
          <div className="flex gap-2">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={installments === n}
                onClick={() => setInstallments(n)}
                className={cn(
                  "h-11 min-w-11 rounded-full border-[1.5px] px-4",
                  installments === n
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-foreground/25",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </fieldset>
        <Button type="submit" disabled={!valid || busy} className={primaryPill}>
          {busy ? "Sending…" : `Offer ${valid ? formatAmount(cents) : "advance"}`}
        </Button>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </form>
  );
}
