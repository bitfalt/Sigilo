"use client";

// Sample data for the worker screens. Pick a state with the URL hash, e.g. /dev-preview/worker#empty.

import { periodIndex } from "@sigilo/core/period";
import type { PayslipReceipt } from "@sigilo/core/receipts";
import { useState, useSyncExternalStore } from "react";

import type { PayslipEntry } from "@/components/worker/payslip-ledger";
import {
  DashboardView,
  InviteJoiningView,
  InviteNoticeView,
  InvitePassportView,
  InviteWelcomeView,
  UnlockView,
} from "@/components/worker/worker-views";

const STATES = [
  "dashboard",
  "loading",
  "empty",
  "unlock",
  "unlock-error",
  "welcome-back",
  "invite",
  "invite-known",
  "invite-open",
  "joining",
  "passport",
  "activating",
  "invite-loading",
  "invite-used",
  "invite-invalid",
] as const;

function payslip(
  month: number,
  grossCents: number,
  deductions: { label: string; amountCents: number }[] = [],
): PayslipEntry {
  const net = grossCents - deductions.reduce((sum, d) => sum + d.amountCents, 0);
  const receipt: PayslipReceipt = {
    v: 1,
    kind: "payslip",
    employer: { name: "Acme Labs", employerId: "0x01" },
    period: periodIndex({ year: 2026, month }),
    grossCents: String(grossCents),
    deductions: deductions.map((d) => ({ label: d.label, amountCents: String(d.amountCents) })),
    netCents: String(net),
    token: "AUSD",
    pieces: [],
    payoutTxHash: "0x00",
    issuedAt: Date.UTC(2026, month - 1, 28, 15),
  };
  return { id: `slip-${month}`, receipt };
}

const PAYSLIPS = [
  payslip(10, 240_000, [{ label: "Advance repayment", amountCents: 22_950 }]),
  payslip(9, 240_000),
  payslip(8, 240_000),
  payslip(7, 225_000),
];

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function WorkerPreview() {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash.slice(1),
    () => "",
  );
  const state = (STATES as readonly string[]).includes(hash) ? hash : "dashboard";
  const [name, setName] = useState("");
  const noop = () => {};

  switch (state) {
    case "loading":
      return <DashboardView balance={null} payslips={null} onLock={noop} />;
    case "empty":
      return <DashboardView balance={0n} payslips={[]} onLock={noop} />;
    case "unlock":
    case "unlock-error":
    case "welcome-back":
      return (
        <UnlockView
          known={state === "welcome-back" ? { displayName: "María" } : null}
          name={name}
          onNameChange={setName}
          busy={false}
          error={
            state === "unlock-error"
              ? "Your password manager can't open Sigilo accounts. Use iCloud Keychain (Passwords) or Google Password Manager."
              : null
          }
          onCreate={noop}
          onSignInKnown={noop}
          onSignInAny={noop}
          onUseAnother={noop}
        />
      );
    case "invite":
    case "invite-known":
    case "invite-open":
      return (
        <InviteWelcomeView
          employerName="Acme Labs"
          access={state === "invite" ? "new" : state === "invite-known" ? "known" : "open"}
          name={name}
          onNameChange={setName}
          error={null}
          onJoinOpen={noop}
          onJoinKnown={noop}
          onJoinAny={noop}
          onUseAnother={noop}
          onCreate={noop}
        />
      );
    case "joining":
      return <InviteJoiningView employerName="Acme Labs" />;
    case "passport":
    case "activating":
      return (
        <InvitePassportView activating={state === "activating"} error={null} onActivate={noop} />
      );
    case "invite-loading":
      return <InviteNoticeView waiting title="Opening your invite…" />;
    case "invite-used":
      return (
        <InviteNoticeView
          title="This invite was already used."
          body="If you joined with it, open your account. If not, ask your employer for a new link."
          action={{ href: "/app", label: "Open your account" }}
        />
      );
    case "invite-invalid":
      return (
        <InviteNoticeView
          title="This invite link isn't valid."
          body="Ask your employer to send you a new one."
        />
      );
    default:
      return <DashboardView balance={9_120_500_000n} payslips={PAYSLIPS} onLock={noop} />;
  }
}
