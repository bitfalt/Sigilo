// Small presentational pieces shared by the employer console views.

import { cn } from "cn";
import { Lock } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { AppShell } from "@/components/app/app-shell";
import { Guilloche } from "@/components/landing/guilloche";
import { SealMark } from "@/components/landing/seal-mark";
import { Button } from "@/components/ui/button";

import "./employer.css";

/** Primary action: ultramarine pill, as on the landing. */
export const primaryPill =
  "h-12 rounded-full px-6 text-[0.975rem] font-semibold hover:bg-[#1f2d8c] focus-visible:ring-offset-2 focus-visible:ring-offset-card";

/** Secondary action: ink outline pill. */
export const secondaryPill =
  "h-11 rounded-full border-[1.5px] border-foreground bg-transparent px-5 text-[0.95rem] font-semibold text-foreground hover:bg-secondary";

/** Inline text action. */
export const textAction =
  "rounded-sm text-sm font-semibold underline decoration-[1.5px] underline-offset-4 outline-none hover:decoration-2 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

export function LockButton({ onClick }: { onClick(): void }) {
  return (
    <Button
      variant="outline"
      onClick={onClick}
      className="h-10 gap-2 rounded-full border-[1.5px] border-foreground/80 bg-transparent px-4 font-semibold"
    >
      <Lock aria-hidden="true" />
      Lock
    </Button>
  );
}

/** Guilloche rosette from the landing, tinted with the app's inks. */
export function Rosette({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none", className)}
      style={{ "--guilloche": "#3f7f67", "--seal": "#2a3cb0" } as CSSProperties}
    >
      <Guilloche className="h-full w-full" />
    </div>
  );
}

/** Full-screen wait or dead-end state: the seal turns while something opens. */
export function ConsoleNotice({
  children,
  busy = false,
  action,
}: {
  children: ReactNode;
  busy?: boolean;
  action?: ReactNode;
}) {
  return (
    <AppShell wide>
      <div className="em-console flex flex-1 flex-col items-center justify-center gap-5 py-16 text-center">
        <SealMark className={cn("size-12 text-foreground/70", busy && "em-turn")} />
        <p className="font-wide text-xl" role="status">
          {children}
        </p>
        {action}
      </div>
    </AppShell>
  );
}

/** "Verified employer" stamp, or the dashed pending mark. */
export function VerificationStamp({ verified }: { verified: boolean }) {
  return verified ? (
    <p className="em-stamp shrink-0 self-start bg-[#f4f6ff]/85 px-3.5 py-2 text-primary sm:self-auto sm:px-4 sm:py-2.5">
      <span className="flex items-center gap-2 font-wide text-base leading-none sm:text-lg">
        <SealMark className="size-5" />
        Verified employer
      </span>
    </p>
  ) : (
    <p className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg border-2 border-dashed border-muted-foreground/50 px-4 py-2.5 font-wide text-base text-muted-foreground sm:self-auto">
      <SealMark className="size-5" />
      Verification pending
    </p>
  );
}

/** Two-letter monogram for a person on the register. */
export function Monogram({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-full border-[1.5px] border-foreground/25 bg-background font-wide text-[0.8rem] tracking-wide",
        className,
      )}
    >
      {initials || "?"}
    </span>
  );
}
