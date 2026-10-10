// The employer's front door: create a company account, or sign back in with its passkey.

import { cn } from "cn";

import { AppShell, Perforation } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Monogram, primaryPill, Rosette, textAction } from "./parts";

const SEALED = [
  { what: "Names and salaries", how: "Encrypted on this device" },
  { what: "Payslips", how: "Sealed to each person's passkey" },
  { what: "Who received which payment", how: "Never stored, anywhere" },
];

export interface UnlockViewProps {
  /** "welcome": a company passkey is remembered on this device. */
  mode: "create" | "welcome";
  knownName?: string;
  company: string;
  onCompanyChange(value: string): void;
  busy: boolean;
  error: string | null;
  onCreate(): void;
  onSignInKnown(): void;
  onSignInAny(): void;
  onCreateAnother(): void;
}

export function UnlockView(props: UnlockViewProps) {
  return (
    <AppShell wide>
      <div className="em-console grid flex-1 content-center gap-x-16 gap-y-8 py-4 sm:py-10 lg:grid-cols-12">
        <h1 className="font-display text-[clamp(2.5rem,7.5vw,4.6rem)] text-balance lg:col-span-6 lg:self-end">
          Payroll nobody else can read.
        </h1>

        <div className="relative lg:col-span-6 lg:col-start-7 lg:row-span-2 lg:row-start-1 lg:self-center">
          <Rosette className="absolute top-1/2 left-1/2 hidden aspect-square w-[128%] -translate-x-1/2 -translate-y-1/2 sm:block" />
          <section
            aria-labelledby="unlock-title"
            className="em-slip relative mx-auto w-full max-w-md"
          >
            {props.mode === "welcome" ? <Welcome {...props} /> : <Create {...props} />}
          </section>
        </div>

        <div className="lg:col-span-6 lg:self-start">
          <p className="max-w-[46ch] text-lg text-pretty text-muted-foreground">
            Add your team, send each person an invite link, and pay everyone in digital dollars at
            once. Salaries stay confidential from everyone, including us.
          </p>
          <dl className="mt-8 max-w-xl divide-y divide-foreground/15 border-y border-foreground/15">
            {SEALED.map((row) => (
              <div
                key={row.what}
                className="flex flex-col gap-0.5 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
              >
                <dt className="font-semibold">{row.what}</dt>
                <dd className="text-muted-foreground">{row.how}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </AppShell>
  );
}

function Create({ company, onCompanyChange, busy, error, onCreate, onSignInAny }: UnlockViewProps) {
  const ready = company.trim().length >= 2;
  return (
    <>
      <form
        className="p-6 sm:p-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && ready) onCreate();
        }}
      >
        <h2 id="unlock-title" className="font-wide text-2xl leading-tight">
          Create your company account
        </h2>
        <p className="mt-2 text-pretty text-muted-foreground">
          It&apos;s secured with a passkey, so there&apos;s no password, and your team&apos;s
          salaries stay private, even from us.
        </p>
        <label htmlFor="company-name" className="mt-6 block text-sm font-semibold">
          Your company
        </label>
        <Input
          id="company-name"
          className="mt-1.5"
          placeholder="Company name"
          autoComplete="organization"
          aria-describedby="company-hint"
          value={company}
          onChange={(e) => onCompanyChange(e.target.value)}
        />
        <p id="company-hint" className="mt-1.5 text-sm text-muted-foreground">
          Your team sees this name on their payslips.
        </p>
        <Button
          type="submit"
          size="lg"
          className={cn(primaryPill, "mt-6 w-full")}
          disabled={busy || !ready}
        >
          {busy ? "Creating your company…" : "Create company account"}
        </Button>
        <Failure error={error} />
      </form>
      <Perforation className="mx-6 sm:mx-8" />
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-6 pt-4 pb-6 text-sm text-muted-foreground sm:px-8">
        Already have one?
        <button type="button" className={textAction} onClick={onSignInAny} disabled={busy}>
          Sign in with a passkey
        </button>
      </p>
    </>
  );
}

function Welcome({ knownName, busy, error, onSignInKnown, onCreateAnother }: UnlockViewProps) {
  return (
    <>
      <div className="p-6 sm:p-8">
        {knownName ? <Monogram name={knownName} className="size-12 text-base" /> : null}
        <h2
          id="unlock-title"
          className={cn("font-wide text-2xl leading-tight text-balance", knownName && "mt-5")}
        >
          {`Welcome back${knownName ? `, ${knownName}` : ""}`}
        </h2>
        <p className="mt-2 text-pretty text-muted-foreground">
          Your company account opens with its passkey. Payroll, your team and your balance are right
          where you left them.
        </p>
        <Button
          size="lg"
          className={cn(primaryPill, "mt-6 w-full")}
          onClick={onSignInKnown}
          disabled={busy}
        >
          {busy ? "Opening your company…" : "Sign in with passkey"}
        </Button>
        <Failure error={error} />
      </div>
      <Perforation className="mx-6 sm:mx-8" />
      <p className="px-6 pt-4 pb-6 text-sm sm:px-8">
        <button type="button" className={textAction} onClick={onCreateAnother} disabled={busy}>
          Create another company
        </button>
      </p>
    </>
  );
}

function Failure({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-4 text-sm text-pretty text-destructive">
      {error}
    </p>
  );
}
