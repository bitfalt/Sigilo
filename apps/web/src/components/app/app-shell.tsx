import Link from "next/link";
import type { ReactNode } from "react";

import { SealMark } from "@/components/landing/seal-mark";

/**
 * Shared frame for the app screens (/app, /employer, /lender, /v): Sigilo wordmark, an optional
 * right-hand action (e.g. Lock), and a centered column. Mobile-first; `wide` for desktop consoles.
 */
export function AppShell({
  children,
  action,
  wide = false,
}: {
  children: ReactNode;
  action?: ReactNode;
  wide?: boolean;
}) {
  const width = wide ? "max-w-5xl" : "max-w-md";
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className={`mx-auto flex h-16 w-full ${width} items-center justify-between px-5`}>
        <Link href="/" className="flex items-center gap-2 rounded-sm">
          <SealMark className="size-6" />
          <span className="font-wide text-lg">Sigilo</span>
        </Link>
        {action}
      </header>
      <main className={`mx-auto flex w-full ${width} flex-1 flex-col px-5 pb-12`}>{children}</main>
    </div>
  );
}

/** Dotted tear-off line between sections, as on a payslip stub. */
export function Perforation({ className = "" }: { className?: string }) {
  return (
    <div
      role="presentation"
      className={`h-2 opacity-35 ${className}`}
      style={{
        backgroundImage: "radial-gradient(circle, currentColor 1.3px, transparent 1.6px)",
        backgroundSize: "11px 8px",
        backgroundRepeat: "repeat-x",
        backgroundPosition: "0 50%",
      }}
    />
  );
}
