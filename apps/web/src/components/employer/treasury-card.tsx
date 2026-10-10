// The treasury, drawn as a cheque: the balance engraved large on security paper.

import { cn } from "cn";

import { Perforation } from "@/components/app/app-shell";
import { Button } from "@/components/ui/button";

import { Rosette, secondaryPill } from "./parts";

export interface TreasuryCardProps {
  /** Formatted balance, or null while it loads. */
  balance: string | null;
  /** Nothing to pay with yet. */
  empty?: boolean;
  busy: boolean;
  message: string | null;
  onAddFunds(): void;
}

export function TreasuryCard({
  balance,
  empty = false,
  busy,
  message,
  onAddFunds,
}: TreasuryCardProps) {
  return (
    <section aria-labelledby="balance-title" className="em-slip em-cheque">
      <Rosette className="absolute top-1/2 -right-40 -z-10 size-[22rem] -translate-y-1/2 opacity-80 [mask-image:linear-gradient(to_left,#000_50%,transparent_92%)] sm:-right-36 sm:size-[26rem]" />
      <div className="px-5 pt-5 pb-6 sm:px-8 sm:pt-7 sm:pb-8">
        <h2 id="balance-title" className="text-sm font-semibold text-muted-foreground">
          Payroll balance
        </h2>
        <p
          className="mt-3 flex min-h-[clamp(2.75rem,8vw,4.25rem)] items-end font-display text-[clamp(2.75rem,8vw,4.25rem)]"
          aria-live="polite"
        >
          {balance ?? (
            <span className="font-sans text-lg font-normal tracking-normal text-muted-foreground">
              Checking your balance…
            </span>
          )}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">Digital dollars (AUSD)</p>
      </div>
      <Perforation className="mx-5 sm:mx-8" />
      <div className="flex flex-col gap-4 px-5 pt-4 pb-5 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:pb-6">
        <p className="max-w-[34ch] text-sm text-pretty text-muted-foreground">
          {empty
            ? "Add test funds to cover your first payroll."
            : "Held in your company account. Only your passkey can move it."}
        </p>
        <div className="flex flex-col gap-2 sm:items-end">
          <Button
            variant="outline"
            onClick={onAddFunds}
            disabled={busy}
            className={cn(secondaryPill, "w-full bg-card/90 sm:w-auto")}
          >
            {busy ? "Adding funds…" : "Add test funds"}
          </Button>
          <p role="status" className="text-sm text-muted-foreground empty:hidden">
            {message}
          </p>
        </div>
      </div>
    </section>
  );
}
