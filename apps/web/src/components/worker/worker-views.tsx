// Presentational screens of the worker app (SPEC.md F1, F4). Props in, callbacks out: the passkey,
// Convex and wallet logic stays in worker-home.tsx and invite-flow.tsx, and
// /dev-preview/worker renders these with sample data.

import { Check, CircleAlert, KeyRound, Lock, Settings } from "lucide-react";
import Link from "next/link";
import type { FormEvent, ReactNode } from "react";

import { AppShell, Perforation } from "@/components/app/app-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PayEnvelope } from "@/components/worker/pay-envelope";
import {
  type PayslipEntry,
  PayslipLedger,
  type TransferEntry,
} from "@/components/worker/payslip-ledger";
import { PassportStamp, Rosette, WaxSeal } from "@/components/worker/worker-art";
import { cn } from "@/lib/utils";

const PRIMARY =
  "h-13 w-full rounded-full text-base font-semibold hover:bg-primary/88 [&_svg:not([class*='size-'])]:size-5";
const QUIET =
  "h-11 rounded-full px-4 text-[0.9375rem] font-medium text-foreground underline decoration-foreground/30 decoration-[1.5px] underline-offset-4 hover:bg-transparent hover:decoration-foreground";
const HEADLINE = "font-display text-[2.5rem] text-balance sm:text-5xl";
const LEDE = "text-muted-foreground mt-4 max-w-[38ch] text-[1.0625rem] leading-relaxed text-pretty";
/** Actions sit low on phones (thumb reach), right under the words on desktop. */
const ACTIONS = "mt-auto pt-10 lg:mt-0";

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-destructive flex items-start gap-2 text-sm">
      <CircleAlert aria-hidden="true" className="mt-px size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Art on top, bleeding off the right edge on phones, words and actions below; side by side on
 * desktop.
 */
function SplitScreen({ art, children }: { art: ReactNode; children: ReactNode }) {
  return (
    <div className="-mx-5 grid flex-1 grid-rows-[auto_1fr] overflow-x-clip px-5 lg:mx-0 lg:grid-cols-2 lg:grid-rows-1 lg:items-center lg:gap-16 lg:overflow-x-visible lg:px-0 lg:py-8">
      <div
        aria-hidden="true"
        className="pointer-events-none -mr-24 -mb-14 justify-self-end lg:m-0 lg:justify-self-stretch"
      >
        {art}
      </div>
      <div className="relative flex max-w-md flex-col">{children}</div>
    </div>
  );
}

function SealArt() {
  return (
    <Rosette className="aspect-square w-64 sm:w-72 lg:mx-auto lg:w-full lg:max-w-md">
      <WaxSeal className="size-16 -rotate-12 lg:size-24" />
    </Rosette>
  );
}

function SpinningSeal() {
  return (
    <Rosette spin className="aspect-square w-56">
      <WaxSeal className="size-14 -rotate-12" />
    </Rosette>
  );
}

// ---------------------------------------------------------------------------------------------
// /app, locked

export interface UnlockViewProps {
  /** The account remembered on this device, if any. */
  known: { displayName: string } | null;
  name: string;
  onNameChange(name: string): void;
  busy: boolean;
  error: string | null;
  onCreate(): void;
  onSignInKnown(): void;
  onSignInAny(): void;
}

export function UnlockView(props: UnlockViewProps) {
  const { known, name, onNameChange, busy, error, onCreate, onSignInKnown, onSignInAny } = props;
  const canCreate = !busy && name.trim().length >= 2;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (canCreate) onCreate();
  }

  if (known) {
    // Locked: the account's seal in the middle of the screen, one way in.
    return (
      <AppShell>
        <div className="flex flex-1 flex-col lg:justify-center">
          <div className="flex flex-1 flex-col items-center justify-center text-center lg:flex-none">
            <Rosette className="aspect-square w-60 sm:w-72">
              <WaxSeal className="size-16 -rotate-12" />
            </Rosette>
            <h1 className={`${HEADLINE} mt-8`}>
              Welcome back{known.displayName ? `, ${known.displayName}` : ""}
            </h1>
            <p className={`${LEDE} mx-auto`}>Your account is locked. Your passkey opens it.</p>
          </div>
          <div className="flex flex-col items-center gap-2 pt-10">
            <Button size="lg" onClick={onSignInKnown} disabled={busy} className={PRIMARY}>
              {busy ? (
                "Opening your account…"
              ) : (
                <>
                  <KeyRound aria-hidden="true" />
                  Sign in with passkey
                </>
              )}
            </Button>
            <Button variant="ghost" onClick={onSignInAny} disabled={busy} className={QUIET}>
              Use a different account
            </Button>
            {error && <ErrorNote>{error}</ErrorNote>}
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell wide>
      <SplitScreen art={<SealArt />}>
        <h1 className={HEADLINE}>Get paid privately.</h1>
        <p className={LEDE}>
          Your salary arrives in an account only you can open, and you can prove what you earn
          without showing your payslip. A passkey opens it, so there&apos;s no password.
        </p>
        <div className={`${ACTIONS} lg:pt-8`}>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <label htmlFor="worker-name" className="text-sm font-medium">
              Your name
            </label>
            <Input
              id="worker-name"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              autoComplete="name"
              className="h-12"
            />
            <Button type="submit" size="lg" disabled={!canCreate} className={`${PRIMARY} mt-2`}>
              {busy ? "Creating your account…" : "Create my account"}
            </Button>
          </form>
          <div className="mt-2 flex flex-wrap items-center gap-x-1">
            <span className="text-muted-foreground text-[0.9375rem]">Have an account?</span>
            <Button
              variant="ghost"
              onClick={onSignInAny}
              disabled={busy}
              className={`${QUIET} -ml-1 px-2`}
            >
              Sign in with a passkey
            </Button>
          </div>
          {error && (
            <div className="mt-3">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}
          <Perforation className="mt-6" />
          <p className="text-muted-foreground mt-4 text-sm text-pretty">
            Invited by your employer? Open the link they sent you. It joins you to their payroll.
          </p>
        </div>
      </SplitScreen>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------------------------
// /app, unlocked

export function DashboardView({
  balance,
  payslips,
  transfers,
  notice,
  onLock,
}: {
  /** AUSD base units; null while the balance is being counted. */
  balance: bigint | null;
  /** null while the payslips are being opened. */
  payslips: PayslipEntry[] | null;
  transfers?: TransferEntry[];
  /** A one-time note, e.g. how fast the account was ready. */
  notice?: string;
  onLock(): void;
}) {
  return (
    <AppShell
      wide
      action={
        <div className="-mr-3 flex items-center">
          <Link
            href="/app/settings"
            className="hover:bg-muted focus-visible:ring-ring/50 inline-flex h-11 items-center gap-2 rounded-full px-4 text-[0.9375rem] font-medium outline-none focus-visible:ring-3"
          >
            <Settings aria-hidden="true" className="size-4" />
            Settings
          </Link>
          <Button
            variant="ghost"
            onClick={onLock}
            className="h-11 gap-2 rounded-full px-4 text-[0.9375rem] font-medium"
          >
            <Lock aria-hidden="true" />
            Lock
          </Button>
        </div>
      }
    >
      <h1 className="sr-only">Your account</h1>
      {notice && (
        <p
          role="status"
          className="bg-card text-foreground mb-2 flex items-start gap-2 rounded-xl px-4 py-3 text-sm shadow-[0_10px_24px_-20px_rgba(15,42,32,0.5)] lg:mb-0"
        >
          <Check aria-hidden="true" className="text-primary mt-0.5 size-4 shrink-0" />
          <span>{notice}</span>
        </p>
      )}
      <div className="grid gap-12 pt-2 lg:grid-cols-12 lg:gap-16 lg:pt-10">
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-10">
            <PayEnvelope balance={balance} />
          </div>
        </div>
        <div className="lg:col-span-7 lg:pt-2">
          <PayslipLedger payslips={payslips} transfers={transfers} />
        </div>
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------------------------
// /app/invite/[code]

/** Where the person is in joining: account first, then the Income Passport. */
function StepBadge({ step }: { step: 1 | 2 }) {
  return (
    <p className="text-muted-foreground flex items-center gap-2.5 text-sm">
      <span aria-hidden="true" className="flex gap-1">
        {[1, 2].map((n) => (
          <span
            key={n}
            className={`h-1 w-5 rounded-full ${n <= step ? "bg-primary" : "bg-foreground/15"}`}
          />
        ))}
      </span>
      Step {step} of 2
    </p>
  );
}

export interface InviteWelcomeViewProps {
  employerName: string;
  /** open: an account is unlocked in this tab. known: one is remembered on this device. */
  access: "open" | "known" | "new";
  name: string;
  onNameChange(name: string): void;
  error: string | null;
  onJoinOpen(): void;
  onJoinKnown(): void;
  onJoinAny(): void;
  onCreate(): void;
}

export function InviteWelcomeView(props: InviteWelcomeViewProps) {
  const { employerName, access, name, onNameChange, error } = props;
  const canCreate = name.trim().length >= 2;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (canCreate) props.onCreate();
  }

  return (
    <AppShell wide action={<StepBadge step={1} />}>
      <SplitScreen art={<SealArt />}>
        <h1 className={HEADLINE}>{employerName} pays you with Sigilo</h1>
        <p className={LEDE}>Your salary stays private. Only you can see it.</p>

        <div className={`${ACTIONS} lg:pt-8`}>
          {access === "open" ? (
            <Button size="lg" onClick={props.onJoinOpen} className={PRIMARY}>
              Join {employerName}
            </Button>
          ) : access === "known" ? (
            <div className="flex flex-col items-start gap-2">
              <Button size="lg" onClick={props.onJoinKnown} className={PRIMARY}>
                <KeyRound aria-hidden="true" />
                Sign in with passkey to join
              </Button>
              <Button variant="ghost" onClick={props.onJoinAny} className={`${QUIET} -ml-4`}>
                Use a different account
              </Button>
            </div>
          ) : (
            <>
              <form onSubmit={submit} className="flex flex-col gap-3">
                <label htmlFor="invite-name" className="text-sm font-medium">
                  Your name
                </label>
                <Input
                  id="invite-name"
                  value={name}
                  onChange={(e) => onNameChange(e.target.value)}
                  autoComplete="name"
                  className="h-12"
                />
                <Button type="submit" size="lg" disabled={!canCreate} className={`${PRIMARY} mt-2`}>
                  Create my account
                </Button>
              </form>
              <Button variant="ghost" onClick={props.onJoinAny} className={`${QUIET} mt-2 -ml-4`}>
                I already have a Sigilo account
              </Button>
            </>
          )}
          {error && (
            <div className="mt-3">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}
        </div>
      </SplitScreen>
    </AppShell>
  );
}

export function InviteJoiningView({ employerName }: { employerName: string }) {
  return (
    <AppShell action={<StepBadge step={1} />}>
      <div className="flex flex-1 flex-col items-center justify-center pb-10 text-center">
        <SpinningSeal />
        <div role="status" className="mt-8">
          <p className="font-wide text-2xl text-balance">Setting up your private account…</p>
          <p className="text-muted-foreground mt-2">Joining the payroll at {employerName}.</p>
        </div>
      </div>
    </AppShell>
  );
}

export function InvitePassportView({
  activating,
  done = false,
  error,
  onActivate,
}: {
  activating: boolean;
  done?: boolean;
  error: string | null;
  onActivate(): void;
}) {
  const stamp = (
    <figure className="w-full max-w-sm">
      <figcaption className="text-muted-foreground lg:bg-background mb-3 text-sm lg:mb-2 lg:inline-block lg:rounded-sm lg:px-1.5 lg:py-0.5">
        What a lender sees
      </figcaption>
      <PassportStamp
        title="Income verified"
        className={`-rotate-3 ${activating ? "motion-safe:animate-pulse" : ""}`}
      >
        <p>At least $1,500 a month for 3 months, from a verified employer.</p>
        <p className="mt-1 text-xs opacity-80">Salary and employer not shared.</p>
      </PassportStamp>
    </figure>
  );

  return (
    <AppShell wide action={<StepBadge step={2} />}>
      <div className="grid flex-1 lg:grid-cols-2 lg:items-center lg:gap-16 lg:py-8">
        <div className="flex max-w-md flex-col lg:order-2">
          <h1 className={`${HEADLINE} pt-4 lg:pt-0`}>Activate your Income Passport</h1>
          <p className={LEDE}>
            Prove what you earn to lenders and landlords without showing your salary or your
            employer.
          </p>
          <div className="mt-8 lg:hidden">{stamp}</div>
          <div className={`${ACTIONS} lg:pt-10`}>
            {done ? (
              <p role="status" className="font-wide text-primary text-lg">
                Your Income Passport is active. Opening your account…
              </p>
            ) : (
              <Button size="lg" onClick={onActivate} disabled={activating} className={PRIMARY}>
                {activating ? "Preparing your passport…" : "Activate Income Passport"}
              </Button>
            )}
            {error && (
              <div className="mt-3">
                <ErrorNote>{error}</ErrorNote>
              </div>
            )}
          </div>
        </div>
        <div className="hidden lg:order-1 lg:block">
          <div className="relative mx-auto aspect-square w-full max-w-md">
            <Rosette className="h-full w-full">
              <WaxSeal className="size-24 -rotate-12" />
            </Rosette>
            <div className="absolute -right-6 bottom-0 w-[80%]">{stamp}</div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/** One-line states of an invite: still loading, not valid, already used. */
export function InviteNoticeView({
  title,
  body,
  action,
  waiting = false,
}: {
  title: string;
  body?: string;
  action?: { href: string; label: string };
  waiting?: boolean;
}) {
  return (
    <AppShell>
      <div className="flex flex-1 flex-col items-center justify-center pb-10 text-center">
        {waiting ? <SpinningSeal /> : <WaxSeal className="size-16 -rotate-12" />}
        <div role={waiting ? "status" : undefined} className="mt-8 max-w-xs">
          <h1 className="font-wide text-2xl text-balance">{title}</h1>
          {body && <p className="text-muted-foreground mt-2 text-pretty">{body}</p>}
        </div>
        {action && (
          <Link
            href={action.href}
            className={cn(buttonVariants({ size: "lg" }), PRIMARY, "mt-8 max-w-xs")}
          >
            {action.label}
          </Link>
        )}
      </div>
    </AppShell>
  );
}
