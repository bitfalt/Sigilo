// The employer dashboard frame: company header, then the cheque and the team register on the
// left and the payroll envelope on the right. Phones stack cheque, payroll, team.

import type { ReactNode } from "react";

import { AppShell, Perforation } from "@/components/app/app-shell";

import { LockButton, VerificationStamp } from "./parts";

export function DashboardView({
  name,
  verified,
  onLock,
  treasury,
  team,
  payroll,
}: {
  name: string;
  verified: boolean;
  onLock(): void;
  treasury: ReactNode;
  team: ReactNode;
  payroll: ReactNode;
}) {
  return (
    <AppShell wide action={<LockButton onClick={onLock} />}>
      <div className="em-console flex flex-col pt-4 sm:pt-8">
        <header className="flex flex-col gap-5 pb-7 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
          <div className="min-w-0">
            <h1 className="font-display text-[clamp(2.25rem,6.5vw,3.75rem)] break-words text-balance">
              {name}
            </h1>
            <p className="mt-3 max-w-[52ch] text-pretty text-muted-foreground">
              {verified
                ? "Your payroll counts toward your team's Income Passports."
                : "Payroll works, but won't count toward Income Passports yet."}
            </p>
          </div>
          <VerificationStamp verified={verified} />
        </header>
        <Perforation />
        {/* DOM order (and phone order) is cheque, payroll, team; from lg the payroll envelope
            takes the right column next to both. */}
        <div className="mt-8 grid items-start gap-10 sm:mt-10 lg:grid-cols-12 lg:grid-rows-[auto_1fr]">
          <div className="min-w-0 lg:col-span-7 lg:row-start-1">{treasury}</div>
          <div className="min-w-0 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1">
            {payroll}
          </div>
          <div className="min-w-0 lg:col-span-7 lg:row-start-2">{team}</div>
        </div>
      </div>
    </AppShell>
  );
}
