"use client";

// The team as a payroll register: one payslip line per person, with a perforated stub that
// carries their status and invite link. The add-person form is the blank line at the bottom.

import { cn } from "cn";
import { Check, Copy, Share } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Monogram, primaryPill } from "./parts";

export type MemberStatus = "invited" | "joined" | "passport";

export interface TeamMember {
  id: string;
  name: string;
  /** Formatted monthly salary, e.g. "$2,400.00". */
  salary: string;
  status: MemberStatus;
  inviteCode?: string;
}

export function TeamRegister({
  members,
  children,
}: {
  /** Undefined while the team loads. */
  members: TeamMember[] | undefined;
  /** The add-person form. */
  children: ReactNode;
}) {
  const count = members?.length ?? 0;
  return (
    <section aria-labelledby="team-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="team-title" className="font-wide text-2xl">
          Team
        </h2>
        {count > 0 && (
          <p className="text-sm text-muted-foreground">
            {count === 1 ? "1 person" : `${count} people`}
          </p>
        )}
      </div>
      <p className="-mt-2 max-w-[52ch] text-sm text-pretty text-muted-foreground">
        Names and salaries are encrypted on this device. Only you can read them.
      </p>

      <div className="em-slip overflow-clip">
        {members === undefined ? (
          <p role="status" className="px-5 py-6 text-muted-foreground sm:px-6">
            Opening your team…
          </p>
        ) : members.length === 0 ? (
          <div className="px-5 py-6 sm:px-6">
            <p className="font-semibold">No one on payroll yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add someone below to create their invite link.
            </p>
          </div>
        ) : (
          <ul>
            {members.map((member) => (
              <MemberRow key={member.id} member={member} />
            ))}
          </ul>
        )}
        {children}
      </div>
    </section>
  );
}

function MemberRow({ member }: { member: TeamMember }) {
  return (
    <li className="grid border-b border-foreground/10 sm:grid-cols-[minmax(0,1fr)_8px_13.5rem]">
      <div className="flex items-center gap-3 px-5 py-4 sm:px-6">
        <Monogram name={member.name} />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="font-semibold break-words">{member.name}</p>
          <p className="text-[0.95rem] whitespace-nowrap">
            <span className="font-wide">{member.salary}</span>
            <span className="text-muted-foreground"> a month</span>
          </p>
        </div>
      </div>
      <div role="presentation" className="em-perf mx-5 text-foreground sm:mx-0" />
      <div className="flex flex-col justify-center gap-2.5 px-5 pt-3 pb-4 sm:py-4 sm:pr-5 sm:pl-4">
        <MemberStatusLine status={member.status} />
        {member.status === "invited" && member.inviteCode && (
          <InviteActions code={member.inviteCode} name={member.name} />
        )}
      </div>
    </li>
  );
}

function MemberStatusLine({ status }: { status: MemberStatus }) {
  if (status === "passport") {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <StatusDot filled>Joined</StatusDot>
        <span className="rounded-md border-[1.5px] border-primary px-1.5 py-0.5 text-xs font-semibold text-primary">
          Income Passport active
        </span>
      </div>
    );
  }
  if (status === "joined") return <StatusDot filled>Joined</StatusDot>;
  return <StatusDot>Invite sent</StatusDot>;
}

function StatusDot({ filled = false, children }: { filled?: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-sm font-semibold",
        !filled && "text-muted-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2.5 rounded-full border-[1.5px] border-current",
          filled && "bg-current",
        )}
      />
      {children}
    </span>
  );
}

function inviteUrl(code: string): string {
  return `${window.location.origin}/app/invite/${code}`;
}

/** Copy (and, on phones, share) an invite link. */
export function InviteActions({ code, name }: { code: string; name: string }) {
  const [copied, setCopied] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShowLink(true); // Clipboard blocked: show the link to copy by hand.
    }
  }

  const action =
    "h-9 gap-1.5 rounded-full border-[1.5px] border-foreground/70 bg-card px-3.5 text-[0.85rem] font-semibold";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={copy} className={action}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          <span aria-live="polite">{copied ? "Copied" : "Copy invite link"}</span>
        </Button>
        {canShare && (
          <Button
            variant="outline"
            className={action}
            onClick={() =>
              navigator
                .share({
                  title: "Join your team on Sigilo",
                  text: `${name}, get paid with Sigilo`,
                  url: inviteUrl(code),
                })
                .catch(() => {})
            }
          >
            <Share aria-hidden="true" />
            Share
          </Button>
        )}
      </div>
      {showLink && (
        <input
          readOnly
          aria-label={`Invite link for ${name}`}
          value={inviteUrl(code)}
          onFocus={(e) => e.currentTarget.select()}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        />
      )}
    </div>
  );
}

export interface AddPersonFormProps {
  name: string;
  salary: string;
  onNameChange(value: string): void;
  onSalaryChange(value: string): void;
  onSubmit(): void;
  busy: boolean;
  error: string | null;
}

export function AddPersonForm({
  name,
  salary,
  onNameChange,
  onSalaryChange,
  onSubmit,
  busy,
  error,
}: AddPersonFormProps) {
  return (
    <form
      aria-labelledby="add-person-title"
      className="bg-secondary/45 px-5 pt-5 pb-6 sm:px-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) onSubmit();
      }}
    >
      <h3 id="add-person-title" className="font-wide text-base">
        Add a person
      </h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Name
          <Input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            autoComplete="off"
            className="font-normal"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Monthly salary (USD)
          <span className="relative">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-base font-normal text-muted-foreground"
            >
              $
            </span>
            <Input
              inputMode="decimal"
              placeholder="2400"
              value={salary}
              onChange={(e) => onSalaryChange(e.target.value)}
              className="pl-7 font-normal tabular-nums"
            />
          </span>
        </label>
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-pretty text-muted-foreground">
          You&apos;ll get a link to send them.
        </p>
        <Button
          type="submit"
          size="lg"
          disabled={busy}
          className={cn(primaryPill, "h-11 w-full px-5 sm:w-auto")}
        >
          {busy ? "Adding…" : "Add and create invite"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
