"use client";

// Take a salary advance (SPEC.md F7). The worker proves her income again, this time for the
// lender's AdvanceVault, with a nonce that commits to her own fresh account and the amount, so the
// advance can only go to her. Then she authorizes her employer to deduct the installments
// (a signature from her session key, no extra prompt).

import { advanceNonce, advanceOwed, mandateTypedData } from "@sigilo/core/advance";
import { MONAD_TESTNET_CHAIN_ID } from "@sigilo/core/constants";
import { SIGILO_TESTNET } from "@sigilo/core/deployments";
import { encryptReceipt, type TransferReceipt } from "@sigilo/core/receipts";
import { verifierScope } from "@sigilo/core/scope";
import { createOneTimeAccount, decodePaymentProfile } from "@sigilo/core/stealth";
import { useConvex, useConvexAuth, useMutation } from "convex/react";
import { Check, KeyRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { hexToBytes, toHex } from "viem";

import { AppShell } from "@/components/app/app-shell";
import { useKeys } from "@/components/sigilo-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { useWorkerAccess } from "@/components/worker/use-worker-access";
import { rememberAnsweredCheck } from "@/lib/answered-checks";
import { PassportStamp, Rosette, WaxSeal } from "@/components/worker/worker-art";
import { ErrorNote } from "@/components/worker/worker-views";
import { passportSecretFromPrf, type WorkerKeys } from "@/lib/identity";
import { passportErrorMessage, sealIncomePassport } from "@/lib/passport-client";
import { getPrf, passkeyErrorMessage } from "@/lib/passkeys";
import { loadIdentity } from "@/lib/public-identity";
import { cn } from "@/lib/utils";
import { formatAmount } from "@/lib/wallet";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const PRIMARY =
  "h-13 w-full rounded-full text-base font-semibold hover:bg-primary/88 [&_svg:not([class*='size-'])]:size-5";
const HEADLINE = "font-display text-[2.25rem] leading-[1.05] text-balance sm:text-5xl";
const MANDATE_DAYS = 365;
const nowSeconds = () => Math.floor(Date.now() / 1000);

export interface AdvanceRequest {
  _id: string;
  lenderName: string;
  thresholdCents: number;
  months: number;
  offer: { amountCents: number; installments: number; feeBps: number };
  offerDeclined?: boolean;
}

/** Owed in cents (as the vault computes it, rounded up to a cent) and the per-paycheck installment. */
export function advanceTerms(offer: AdvanceRequest["offer"]) {
  const owed = advanceOwed(BigInt(offer.amountCents) * 10_000n, offer.feeBps);
  const owedCents = Number((owed + 9_999n) / 10_000n);
  const installmentCents = Math.ceil(owedCents / offer.installments);
  return { owedCents, installmentCents };
}

type Step =
  | { kind: "offer" }
  | { kind: "working"; label: string; startedAt?: number }
  | { kind: "done"; employerName: string }
  | { kind: "declined" };

export function AdvanceOffer({
  request,
  taken,
}: {
  request: AdvanceRequest;
  /** Set once this offer was taken (here or on another device). */
  taken: { amount: string } | null;
}) {
  const keys = useKeys("worker");
  const { known, signIn } = useWorkerAccess();
  const { isAuthenticated } = useConvexAuth();
  const convex = useConvex();
  const decline = useMutation(api.advances.decline);
  const [step, setStep] = useState<Step>({ kind: "offer" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { offer, lenderName } = request;
  const { owedCents, installmentCents } = advanceTerms(offer);
  const n = offer.installments;

  // So the offer also shows on the account screen if they leave this page.
  useEffect(() => rememberAnsweredCheck(request._id), [request._id]);

  async function sayNo() {
    setBusy(true);
    setError(null);
    try {
      await decline({ request: request._id as Id<"verificationRequests"> });
      setStep({ kind: "declined" });
    } catch {
      setError("Couldn't send your answer. Try again.");
    } finally {
      setBusy(false);
    }
  }

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

  async function take(keys: WorkerKeys) {
    setError(null);
    setStep({ kind: "working", label: "Confirming it's you…" });
    try {
      const { prf } = await getPrf("passport", loadIdentity("worker") ?? undefined);
      const passportSecret = passportSecretFromPrf(prf);

      setStep({ kind: "working", label: "Checking your payslips…" });
      const [stored, registryLeaves] = await Promise.all([
        convex.query(api.receipts.mine, {}),
        convex.query(api.registry.leaves, {}),
      ]);

      // A fresh account of her own for the advance; the nonce commits to it and the amount.
      const oneTime = createOneTimeAccount(decodePaymentProfile(keys.paymentProfile));
      const amount = BigInt(offer.amountCents) * 10_000n;
      const deadline = BigInt(nowSeconds() + 10 * 60);
      const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
      const sealed = await sealIncomePassport({
        keys,
        passportSecret,
        stored,
        registryLeaves,
        thresholdCents: request.thresholdCents,
        months: request.months,
        scope: verifierScope(SIGILO_TESTNET.advanceVault, MONAD_TESTNET_CHAIN_ID),
        nonce: advanceNonce(oneTime.address, amount, deadline, salt),
        onSealing: () =>
          setStep({
            kind: "working",
            label: "Sealing your Income Passport…",
            startedAt: Date.now(),
          }),
      });

      setStep({ kind: "working", label: `Asking ${lenderName} for the money…` });
      const receipt: TransferReceipt = {
        v: 1,
        kind: "advance",
        from: lenderName,
        memo: `Advance, repaid from your next ${n === 1 ? "paycheck" : `${n} paychecks`}`,
        token: "AUSD",
        pieces: [
          {
            account: oneTime.address,
            ephemeralPubKey: oneTime.ephemeralPubKey,
            amount: amount.toString(),
          },
        ],
        issuedAt: nowSeconds() * 1000,
      };
      const taken = await convex.action(api.advances.take, {
        request: request._id as Id<"verificationRequests">,
        proof: sealed.proof,
        publicInputs: sealed.publicInputs,
        amount: amount.toString(),
        recipient: oneTime.address,
        deadline: Number(deadline),
        salt,
        receipt: encryptReceipt(receipt, hexToBytes(keys.receiptPublicKey)),
      });

      setStep({ kind: "working", label: `Setting up the deduction with ${sealed.employerName}…` });
      const installment = BigInt(installmentCents) * 10_000n;
      const mandateDeadline = BigInt(nowSeconds() + MANDATE_DAYS * 86_400);
      const mandate = {
        vault: SIGILO_TESTNET.advanceVault,
        advanceId: BigInt(taken.advanceId),
        installment,
        installments: n,
        deadline: mandateDeadline,
      };
      const signature = await keys.account.signTypedData(mandateTypedData(mandate));
      await convex.action(api.advances.authorize, {
        advance: taken.advance,
        employerId: sealed.employerId,
        installment: installment.toString(),
        installments: n,
        deadline: Number(mandateDeadline),
        signature,
      });
      setStep({ kind: "done", employerName: sealed.employerName });
    } catch (e) {
      setStep({ kind: "offer" });
      setError(passportErrorMessage(e));
    }
  }

  if (step.kind === "done") {
    return (
      <AppShell>
        <div className="flex flex-1 flex-col justify-center gap-8 py-8">
          <PassportStamp title="Advance received" className="-rotate-2 self-start">
            {formatAmount(offer.amountCents)} from {lenderName} is in your account.
          </PassportStamp>
          <div>
            <h1 className={HEADLINE}>The money is yours</h1>
            <p className="text-muted-foreground mt-4 text-[1.0625rem] leading-relaxed">
              {step.employerName} will take {formatAmount(installmentCents)} from your next{" "}
              {n === 1 ? "paycheck" : `${n} paychecks`} and pay {lenderName} directly. Nothing else
              to do.
            </p>
          </div>
          <Link href="/app" className={cn(buttonVariants({ size: "lg" }), PRIMARY)}>
            Open my account
          </Link>
        </div>
      </AppShell>
    );
  }

  if (step.kind === "declined" || (request.offerDeclined && step.kind === "offer")) {
    return (
      <AppShell>
        <div className="flex flex-1 flex-col justify-center gap-6 py-8">
          <h1 className={HEADLINE}>No advance, no problem</h1>
          <p className="text-muted-foreground text-[1.0625rem] leading-relaxed">
            You turned down {formatAmount(offer.amountCents)} from {lenderName}. Nothing was
            borrowed and nothing comes out of your paychecks.
          </p>
          <Link href="/app" className={cn(buttonVariants({ size: "lg" }), PRIMARY)}>
            Open my account
          </Link>
        </div>
      </AppShell>
    );
  }

  if (taken && step.kind === "offer") {
    return (
      <AppShell>
        <div className="flex flex-1 flex-col justify-center gap-6 py-8">
          <PassportStamp title="Advance received" className="-rotate-2 self-start">
            {formatAmount(Number(BigInt(taken.amount) / 10_000n))} from {lenderName}.
          </PassportStamp>
          <p className="text-muted-foreground text-[1.0625rem] leading-relaxed">
            It&apos;s repaid from your next {n === 1 ? "paycheck" : `${n} paychecks`},{" "}
            {formatAmount(installmentCents)} each.
          </p>
          <Link href="/app" className={cn(buttonVariants({ size: "lg" }), PRIMARY)}>
            Open my account
          </Link>
        </div>
      </AppShell>
    );
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
          <p className="text-muted-foreground text-[0.9375rem]">Salary advance</p>
          <h1 className={`${HEADLINE} mt-2`}>
            {lenderName} offers you {formatAmount(offer.amountCents)} now
          </h1>
          <p className="text-muted-foreground mt-4 text-[1.0625rem] leading-relaxed text-pretty">
            Your income is verified, so you can have it today. You pay it back from your next{" "}
            {n === 1 ? "paycheck" : `${n} paychecks`}, taken out automatically by your employer.
          </p>
        </div>

        <dl className="bg-card grid gap-3 rounded-2xl p-6 text-[0.9375rem] tabular-nums shadow-[0_18px_40px_-28px_rgba(15,42,32,0.45)]">
          <Row label="You get today" value={formatAmount(offer.amountCents)} strong />
          <Row
            label={`Fee (${(offer.feeBps / 100).toFixed(0)}%)`}
            value={formatAmount(owedCents - offer.amountCents)}
          />
          <Row label="You repay" value={formatAmount(owedCents)} />
          <Row label="From each paycheck" value={`${formatAmount(installmentCents)} × ${n}`} />
        </dl>

        <ul className="text-muted-foreground flex flex-col gap-1.5 text-sm">
          <li className="flex gap-2">
            <Check aria-hidden="true" className="text-primary mt-0.5 size-4 shrink-0" />
            {lenderName} still doesn&apos;t see your salary or your payslips.
          </li>
          <li className="flex gap-2">
            <Check aria-hidden="true" className="text-primary mt-0.5 size-4 shrink-0" />
            Your employer sees the deduction on your payslip, like any other.
          </li>
        </ul>

        <div className="mt-auto flex flex-col gap-3">
          {keys && isAuthenticated ? (
            <Button size="lg" className={PRIMARY} onClick={() => take(keys)}>
              <WaxSeal className="size-6" />
              Take {formatAmount(offer.amountCents)}
            </Button>
          ) : (
            <Button size="lg" className={PRIMARY} onClick={openAccount} disabled={busy}>
              {busy ? (
                "Opening your account…"
              ) : (
                <>
                  <KeyRound aria-hidden="true" />
                  Sign in with passkey
                </>
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="lg"
            className="h-12 rounded-full text-base"
            onClick={sayNo}
            disabled={busy}
          >
            No thanks
          </Button>
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
      </div>
    </AppShell>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? "font-wide text-2xl" : "font-semibold"}>{value}</dd>
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
