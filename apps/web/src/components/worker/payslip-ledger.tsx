"use client";

// Pay history as a ruled ledger on the page: one line per payslip ("You got paid", employer,
// month, net amount) that opens into the payslip itself, decrypted on this device.

import { periodFromIndex } from "@sigilo/core/period";
import type { PayslipReceipt } from "@sigilo/core/receipts";
import { Check, ChevronDown, Share } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { periodLabel } from "@/lib/periods";
import { formatCents } from "@/lib/wallet";

export interface PayslipEntry {
  id: string;
  receipt: PayslipReceipt;
}

/** `payslips` is null while the payslips are being opened. */
export function PayslipLedger({ payslips }: { payslips: PayslipEntry[] | null }) {
  return (
    <section aria-labelledby="payslips-title">
      <h2 id="payslips-title" className="font-wide text-xl">
        Payslips
      </h2>
      {payslips === null ? (
        <p className="text-muted-foreground border-foreground/15 mt-4 border-t py-6 text-sm">
          Opening your payslips…
        </p>
      ) : payslips.length === 0 ? (
        <EmptyPayslips />
      ) : (
        <ul className="border-foreground/15 mt-4 border-t">
          {payslips.map((entry) => (
            <PayslipRow key={entry.id} receipt={entry.receipt} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PayslipRow({ receipt }: { receipt: PayslipReceipt }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const [month, year] = periodLabel(receipt.period).split(" ");

  return (
    <li className="border-foreground/15 border-b">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((o) => !o)}
        className="group focus-visible:ring-ring/50 hover:bg-foreground/[0.03] -mx-2 grid min-h-16 w-[calc(100%+1rem)] grid-cols-[3rem_1fr_auto] items-center gap-x-3 rounded-lg px-2 py-3.5 text-left transition-colors outline-none focus-visible:ring-3"
      >
        <span className="leading-none" aria-hidden="true">
          <span className="font-wide block text-[1.0625rem]">{month}</span>
          <span className="text-muted-foreground mt-1 block text-xs tabular-nums">{year}</span>
        </span>
        <span className="min-w-0">
          <span className="block font-medium">You got paid</span>
          <span className="text-muted-foreground block truncate text-sm">
            {receipt.employer.name}
            <span className="sr-only">, {periodLabel(receipt.period)}</span>
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="font-wide text-[1.0625rem] tabular-nums">
            {formatCents(receipt.netCents)}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`text-muted-foreground size-4 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      <div
        id={panel}
        inert={!open}
        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden">
          <PayslipSheet receipt={receipt} />
        </div>
      </div>
    </li>
  );
}

/** The opened payslip, laid out like the paper one. */
function PayslipSheet({ receipt }: { receipt: PayslipReceipt }) {
  const { year, month } = periodFromIndex(receipt.period);
  const longPeriod = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const paidOn = new Date(receipt.issuedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="bg-card mb-4 rounded-md p-5 shadow-[0_1px_0_rgba(15,42,32,0.06),0_14px_30px_-22px_rgba(15,42,32,0.5)]">
      <p className="font-semibold">{receipt.employer.name}</p>
      <p className="text-muted-foreground text-sm">Payslip, {longPeriod}</p>
      <dl className="mt-4 space-y-1.5 text-sm tabular-nums">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Gross pay</dt>
          <dd>{formatCents(receipt.grossCents)}</dd>
        </div>
        {receipt.deductions.length === 0 ? (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Deductions</dt>
            <dd>{formatCents(0)}</dd>
          </div>
        ) : (
          receipt.deductions.map((d, i) => (
            <div key={i} className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{d.label}</dt>
              <dd>−{formatCents(d.amountCents)}</dd>
            </div>
          ))
        )}
      </dl>
      <div className="border-foreground/20 mt-4 flex items-end justify-between gap-4 border-t-2 border-dashed pt-3">
        <div>
          <p className="text-muted-foreground text-sm">Net pay</p>
          <p className="font-wide text-2xl tabular-nums">{formatCents(receipt.netCents)}</p>
        </div>
        <p className="text-muted-foreground pb-1 text-xs">Paid {paidOn}</p>
      </div>
      <p className="text-muted-foreground mt-3 text-xs">Only you can open this payslip.</p>
    </div>
  );
}

const EMPLOYER_PITCH =
  "I'd like to get paid with Sigilo: private payroll in digital dollars. You can set it up here:";

/** No payslips yet: say how they arrive, and let the worker bring their employer. */
function EmptyPayslips() {
  const [copied, setCopied] = useState(false);

  async function invite() {
    const url = `${window.location.origin}/employer`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Sigilo", text: EMPLOYER_PITCH, url });
      } else {
        await navigator.clipboard.writeText(`${EMPLOYER_PITCH} ${url}`);
        setCopied(true);
      }
    } catch {
      // Closed the share sheet or clipboard blocked: nothing to do.
    }
  }

  return (
    <div className="border-foreground/25 mt-4 rounded-xl border-2 border-dashed px-5 py-6">
      <p className="font-wide text-lg">No payslips yet</p>
      <p className="text-muted-foreground mt-1.5 max-w-[42ch] text-sm text-pretty">
        Your payslips land here, sealed so only you can open them. Invited by your employer? Open
        the link they sent you to join their payroll.
      </p>
      <Button
        variant="outline"
        onClick={invite}
        className="border-foreground hover:bg-secondary mt-5 h-11 rounded-full border-[1.5px] bg-transparent px-5 text-[0.9375rem] font-semibold"
      >
        {copied ? <Check aria-hidden="true" /> : <Share aria-hidden="true" />}
        {copied ? "Link copied" : "Invite your employer"}
      </Button>
    </div>
  );
}
