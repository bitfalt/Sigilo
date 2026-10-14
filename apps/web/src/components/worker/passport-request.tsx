"use client";

// Answer a lender's income check with the Income Passport (SPEC.md F5). Sign in, then a second
// passkey prompt (the passport namespace) unlocks the passport secret; the payslips are decrypted
// and the Income Passport is sealed on this device. Only the sealed answer leaves it.

import { useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
import { Check, KeyRound, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app/app-shell";
import { useKeys } from "@/components/sigilo-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { PassportStamp, Rosette, WaxSeal } from "@/components/worker/worker-art";
import { ErrorNote } from "@/components/worker/worker-views";
import { AdvanceOffer } from "@/components/worker/advance-offer";
import { useWorkerAccess } from "@/components/worker/use-worker-access";
import { rememberAnsweredCheck } from "@/lib/answered-checks";
import { passportSecretFromPrf, type WorkerKeys } from "@/lib/identity";
import { getPrf, passkeyErrorMessage } from "@/lib/passkeys";
import { periodLabel } from "@/lib/periods";
import { AnswerError, passportErrorMessage, sealIncomePassport } from "@/lib/passport-client";
import { loadIdentity } from "@/lib/public-identity";
import { cn } from "@/lib/utils";
import { formatAmount } from "@/lib/wallet";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const PRIMARY =
  "h-13 w-full rounded-full text-base font-semibold hover:bg-primary/88 [&_svg:not([class*='size-'])]:size-5";
const HEADLINE = "font-display text-[2.25rem] leading-[1.05] text-balance sm:text-5xl";

type Step =
  | { kind: "ask" }
  | { kind: "working"; label: string; startedAt?: number }
  | { kind: "done"; periods: number[] };

export function PassportRequest({ requestId }: { requestId: string }) {
  const request = useQuery(api.requests.get, { request: requestId });
  const keys = useKeys("worker");
  const { known, signIn } = useWorkerAccess();
  const { isAuthenticated } = useConvexAuth();
  const convex = useConvex();
  const register = useMutation(api.accounts.register);

  const [step, setStep] = useState<Step>({ kind: "ask" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openAccount() {
    setBusy(true);
    setError(null);
    try {
      await signIn(!!known);
    } catch (e) {
      setError(passkeyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function share(keys: WorkerKeys) {
    if (!request) return;
    setError(null);
    setStep({ kind: "working", label: "Confirming it's you…" });
    try {
      const { prf } = await getPrf("passport", loadIdentity("worker") ?? undefined);
      const passportSecret = passportSecretFromPrf(prf);

      setStep({ kind: "working", label: "Checking your payslips…" });
      await register({
        paymentProfile: keys.paymentProfile,
        receiptPublicKey: keys.receiptPublicKey,
      });
      const [stored, registryLeaves] = await Promise.all([
        convex.query(api.receipts.mine, {}),
        convex.query(api.registry.leaves, {}),
      ]);
      const sealed = await sealIncomePassport({
        keys,
        passportSecret,
        stored,
        registryLeaves,
        thresholdCents: request.thresholdCents,
        months: request.months,
        scope: BigInt(request.scope),
        nonce: BigInt(request.nonce),
        onSealing: () =>
          setStep({
            kind: "working",
            label: "Sealing your Income Passport…",
            startedAt: Date.now(),
          }),
      });

      setStep({ kind: "working", label: `Sending it to ${request.lenderName}…` });
      const result = await convex.action(api.requests.submit, {
        request: requestId as Id<"verificationRequests">,
        proof: sealed.proof,
        publicInputs: sealed.publicInputs,
      });
      if (!result.ok) throw new AnswerError(result.reason);
      rememberAnsweredCheck(requestId);
      setStep({ kind: "done", periods: sealed.periods });
    } catch (e) {
      setStep({ kind: "ask" });
      setError(passportErrorMessage(e));
    }
  }

  if (request === undefined) return <Notice>Opening the request…</Notice>;
  if (request === null) {
    return <Notice title="This link isn't valid">Ask for a new link to the income check.</Notice>;
  }

  const amount = formatAmount(request.thresholdCents);
  // After a verified check the lender may offer an advance; it shows up here live.
  if (request.status === "verified" && request.offer) {
    return (
      <AdvanceOffer
        request={{ ...request, offer: request.offer }}
        taken={request.advance ? { amount: request.advance.amount } : null}
      />
    );
  }
  if (step.kind === "done") {
    return (
      <AppShell>
        <div className="flex flex-1 flex-col justify-center gap-8 py-8">
          <PassportStamp title="Income verified" className="-rotate-2 self-start">
            At least {amount} a month for {request.months} months, from a verified employer.
          </PassportStamp>
          <div>
            <h1 className={HEADLINE}>Sent to {request.lenderName}</h1>
            <p className="text-muted-foreground mt-4 text-[1.0625rem] leading-relaxed">
              They can now confirm your income for {periodRange(step.periods)}. They didn&apos;t see
              your employer, your salary or your payslips.
            </p>
            <p className="text-muted-foreground mt-3 text-sm">
              If {request.lenderName} offers you an advance, it appears right here.
            </p>
          </div>
          <Link href="/app" className={cn(buttonVariants({ size: "lg" }), PRIMARY)}>
            Open my account
          </Link>
        </div>
      </AppShell>
    );
  }

  if (request.status !== "open") {
    const title =
      request.status === "expired"
        ? "This request expired"
        : request.status === "rejected"
          ? "This request was closed"
          : "Already answered";
    const body =
      request.status === "expired"
        ? `Ask ${request.lenderName} for a new link.`
        : `${request.lenderName} already has the answer to this income check.`;
    return <Notice title={title}>{body}</Notice>;
  }

  if (step.kind === "working") {
    return (
      <AppShell>
        <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
          <Rosette spin className="aspect-square w-56">
            <WaxSeal className="size-14 -rotate-12" />
          </Rosette>
          <div aria-live="polite">
            <p className="font-wide text-xl">{step.label}</p>
            {step.startedAt && <Elapsed since={step.startedAt} />}
            <p className="text-muted-foreground mt-2 text-sm">
              This happens on your phone. Your payslips stay here.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex flex-1 flex-col gap-8 py-6">
        <div>
          <p className="text-muted-foreground text-[0.9375rem]">Income check</p>
          <h1 className={`${HEADLINE} mt-2`}>{request.lenderName} wants to confirm your income</h1>
          <p className="text-muted-foreground mt-4 text-[1.0625rem] leading-relaxed text-pretty">
            Do you earn at least {amount} a month, for the last {request.months} months? Answer with
            your Income Passport instead of sending payslips.
          </p>
        </div>

        <div className="bg-card grid gap-5 rounded-2xl p-5 shadow-[0_18px_40px_-28px_rgba(15,42,32,0.45)] sm:grid-cols-2">
          <Disclosure
            title="They will see"
            icon={<Check aria-hidden="true" className="text-primary size-4" />}
            items={[
              `You earn at least ${amount} a month`,
              `For ${request.months} months in a row`,
              "Your employer is verified by Sigilo",
            ]}
          />
          <Disclosure
            title="They won't see"
            icon={<X aria-hidden="true" className="text-muted-foreground size-4" />}
            items={["Your employer's name", "Your exact salary", "Your payslips or your account"]}
          />
        </div>

        <div className="mt-auto flex flex-col gap-3">
          {keys && isAuthenticated ? (
            <Button size="lg" className={PRIMARY} onClick={() => share(keys)}>
              <WaxSeal className="size-6" />
              Share my Income Passport
            </Button>
          ) : (
            <Button size="lg" className={PRIMARY} onClick={openAccount} disabled={busy}>
              {busy ? (
                "Opening your account…"
              ) : (
                <>
                  <KeyRound aria-hidden="true" />
                  Sign in with passkey to answer
                </>
              )}
            </Button>
          )}
          <p className="text-muted-foreground text-center text-sm">
            {keys
              ? "Your passkey confirms it's you. Your payslips never leave this phone."
              : "Don't have Sigilo? Your employer sends you an invite."}
          </p>
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
      </div>
    </AppShell>
  );
}

function Disclosure({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: string[];
}) {
  return (
    <div>
      <p className="font-wide text-base">{title}</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-[0.9375rem] leading-snug">
            <span className="mt-0.5">{icon}</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  return (
    <p className="text-muted-foreground mt-1 text-sm tabular-nums">
      {((now - since) / 1000).toFixed(1)} s
    </p>
  );
}

function Notice({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <AppShell>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        {title && <h1 className="font-display text-3xl">{title}</h1>}
        <p className="text-muted-foreground max-w-[34ch]">{children}</p>
      </div>
    </AppShell>
  );
}

function periodRange(periods: number[]): string {
  if (periods.length === 0) return "";
  const first = periodLabel(periods[0]!);
  const last = periodLabel(periods[periods.length - 1]!);
  return first === last ? first : `${first} to ${last}`;
}
