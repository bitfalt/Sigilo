"use client";

// Send home (SPEC.md F8). The money is prepared on this device: the pieces to spend, a fresh
// account for the recipient, one signature per piece bound to this payment, and the recipient's
// sealed receipt. The relay is called without signing in, so Sigilo can't tell who sent it.
// Agora converts the digital dollars on the way at a fixed price.

import { prepareSendHome } from "@sigilo/core/send";
import { ConvexHttpClient } from "convex/browser";
import { useQuery } from "convex/react";
import { Check, HouseHeart, UserRound } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/app/app-shell";
import { useKeys } from "@/components/sigilo-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRegisteredAccount } from "@/components/worker/use-account";
import { PassportStamp } from "@/components/worker/worker-art";
import { WorkerUnlock } from "@/components/worker/worker-home";
import { ErrorNote } from "@/components/worker/worker-views";
import { quoteCtk } from "@/lib/chain";
import { CONVEX_URL } from "@/lib/config";
import {
  type Contact,
  loadContacts,
  parseSendLink,
  renameContact,
  saveContact,
} from "@/lib/contacts";
import { recordSent } from "@/lib/sent-history";
import { errorMessage } from "@/lib/errors";
import type { WorkerKeys } from "@/lib/identity";
import { loadIdentity } from "@/lib/public-identity";
import { cn } from "@/lib/utils";
import { formatAmount, formatUsd, loadWallet, type Wallet } from "@/lib/wallet";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const PRIMARY =
  "h-13 w-full rounded-full text-base font-semibold hover:bg-primary/88 [&_svg:not([class*='size-'])]:size-5";
const HEADLINE = "font-display text-[2.25rem] leading-[1.05] text-balance sm:text-5xl";

export function SendHome() {
  const keys = useKeys("worker");
  return keys ? <SendForm keys={keys} /> : <WorkerUnlock />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      action={
        <Link
          href="/app"
          className="rounded-sm text-[0.9375rem] font-medium underline underline-offset-4"
        >
          Back
        </Link>
      }
    >
      <div className="flex flex-1 flex-col gap-8 py-6">{children}</div>
    </AppShell>
  );
}

function SendForm({ keys }: { keys: WorkerKeys }) {
  const params = useSearchParams();
  const account = useRegisteredAccount(keys);
  // A "send to" link selects (and remembers) its recipient. This view only renders on the
  // client (it needs unlocked keys), so reading device storage here is safe.
  const [contacts, setContacts] = useState<Contact[]>(() => {
    const linked = params.get("to");
    return linked
      ? saveContact({ account: linked, name: params.get("name")?.slice(0, 40) ?? "" })
      : loadContacts();
  });
  // Only a link picks the recipient; otherwise ask every time (someone saved, or someone new).
  const [to, setTo] = useState<Contact | null>(() => (params.get("to") ? contacts[0]! : null));

  const stored = useQuery(api.receipts.mine, account ? {} : "skip");
  // Bumped after each send: a new payment form, and balances re-read (sending leaves no new
  // receipt here, so `stored` alone wouldn't refresh them).
  const [round, setRound] = useState(0);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  useEffect(() => {
    if (!stored) return;
    let cancelled = false;
    loadWallet(stored, keys).then((w) => !cancelled && setWallet(w));
    return () => {
      cancelled = true;
    };
  }, [stored, keys, round]);
  const startOver = useCallback(() => {
    setWallet(null);
    setTo(null);
    setRound((r) => r + 1);
  }, []);

  if (!to) {
    return (
      <PickRecipient
        contacts={contacts}
        onPick={setTo}
        onRename={(account, name) => setContacts(renameContact(account, name))}
        onAdd={(c) => {
          const next = saveContact(c);
          setContacts(next);
          setTo(next[0]!);
        }}
      />
    );
  }
  return (
    <Payment
      key={round}
      sender={keys.address}
      to={to}
      wallet={wallet}
      self={account}
      onChangeRecipient={() => setTo(null)}
      onFinished={startOver}
    />
  );
}

function PickRecipient({
  contacts,
  onPick,
  onRename,
  onAdd,
}: {
  contacts: Contact[];
  onPick(c: Contact): void;
  onRename(account: string, name: string): void;
  onAdd(c: Contact): void;
}) {
  const [link, setLink] = useState("");
  const [renaming, setRenaming] = useState<{ account: string; name: string } | null>(null);
  const parsed = parseSendLink(link);

  return (
    <Shell>
      <div>
        <h1 className={HEADLINE}>Send home</h1>
        <p className="text-muted-foreground mt-4 text-[1.0625rem] leading-relaxed text-pretty">
          {contacts.length > 0
            ? "Who are you sending to?"
            : "Ask your family for their Sigilo link (they find it under “Get money from family”) and open it here."}
        </p>
      </div>
      {contacts.length > 0 && (
        <ul className="border-foreground/15 border-t">
          {contacts.map((c) => (
            <li key={c.account} className="border-foreground/15 flex items-center gap-2 border-b">
              {renaming?.account === c.account ? (
                <form
                  className="flex min-h-16 flex-1 items-center gap-2 py-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = renaming.name.trim().slice(0, 40);
                    if (name) onRename(c.account, name);
                    setRenaming(null);
                  }}
                >
                  <Input
                    aria-label="Their name"
                    autoFocus
                    value={renaming.name}
                    maxLength={40}
                    onChange={(e) => setRenaming({ account: c.account, name: e.target.value })}
                    className="h-11 flex-1"
                  />
                  <Button type="submit" className="h-11 rounded-full px-5">
                    Save
                  </Button>
                </form>
              ) : (
                <>
                  <button
                    onClick={() => onPick(c)}
                    className="focus-visible:ring-ring/50 hover:bg-foreground/[0.03] flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 text-left outline-none focus-visible:ring-3"
                  >
                    <UserRound
                      aria-hidden="true"
                      className="text-muted-foreground size-5 shrink-0"
                    />
                    <span className="font-medium break-words">
                      Send to {c.name || "family member"}
                    </span>
                  </button>
                  <button
                    onClick={() => setRenaming({ account: c.account, name: c.name })}
                    className="text-muted-foreground focus-visible:ring-ring/50 shrink-0 rounded-sm px-2 py-3 text-sm underline underline-offset-4 outline-none focus-visible:ring-3"
                  >
                    Rename
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-auto flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed) onAdd(parsed);
        }}
      >
        <label htmlFor="send-link" className="text-sm font-semibold">
          {contacts.length > 0 ? "Someone new? Paste their link" : "Paste their link"}
        </label>
        <Input
          id="send-link"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://sigilo.work/app/send?to=…"
          className="h-12"
        />
        <Button type="submit" size="lg" disabled={!parsed} className={PRIMARY}>
          Continue
        </Button>
      </form>
    </Shell>
  );
}

const now = () => performance.now();

type Step = { kind: "form" } | { kind: "sending" } | { kind: "done"; ms: number; cents: number };

function Payment({
  to,
  wallet,
  self,
  onChangeRecipient,
  onFinished,
  sender,
}: {
  /** This account, for its on-device "Money sent" list. */
  sender: string;
  to: Contact;
  wallet: Wallet | null;
  self: Id<"accounts"> | null;
  onChangeRecipient?: () => void;
  /** After a delivery: back to "who are you sending to?" with fresh balances. */
  onFinished(): void;
}) {
  const recipient = useQuery(api.transfers.recipient, { account: to.account });
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>({ kind: "form" });
  const [error, setError] = useState<string | null>(null);
  const relay = useMemo(() => new ConvexHttpClient(CONVEX_URL), []);
  const name = to.name || "your family";

  const cents = Math.round(Number(amount) * 100);
  const spendable = wallet ? Number(wallet.spendable / 10_000n) : 0;
  const valid = Number.isFinite(cents) && cents >= 100 && cents <= spendable;

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!wallet || !recipient || !valid) return;
    setError(null);
    setStep({ kind: "sending" });
    const started = now();
    try {
      const prepared = await prepareSendHome({
        pieces: wallet.pieces.filter((p) => p.token === "AUSD"),
        amount: BigInt(cents) * 10_000n,
        recipient,
        quote: quoteCtk,
        from: loadIdentity("worker")?.displayName?.trim().slice(0, 40) || "Family",
      });
      await relay.action(api.transfers.sendHome, {
        auths: prepared.auths.map((a) => ({
          from: a.from,
          value: a.value.toString(),
          signature: a.signature,
        })),
        intent: {
          to: prepared.intent.to,
          total: prepared.intent.total.toString(),
          minOut: prepared.intent.minOut.toString(),
          deadline: Number(prepared.intent.deadline),
          salt: prepared.intent.salt,
        },
        recipient: to.account as Id<"accounts">,
        receipt: prepared.receipt,
      });
      const ms = Math.round(now() - started);
      recordSent(sender, { name, cents, at: performance.timeOrigin + now(), ms });
      setStep({ kind: "done", ms, cents });
    } catch (err) {
      setStep({ kind: "form" });
      setError(errorMessage(err, "The money didn't go out. Nothing was sent; try again."));
    }
  }

  // Leaving the delivered screen (or the page, which Next keeps alive) starts a new send.
  const delivered = step.kind === "done";
  useEffect(() => {
    if (delivered) return () => onFinished();
  }, [delivered, onFinished]);

  if (recipient === null) {
    return (
      <Shell>
        <h1 className={HEADLINE}>This link isn&apos;t valid</h1>
        <p className="text-muted-foreground">Ask for their Sigilo link again.</p>
      </Shell>
    );
  }

  if (step.kind === "done") {
    return (
      <Shell>
        <div className="flex flex-1 flex-col justify-center gap-8">
          <PassportStamp
            title={`Delivered in ${(step.ms / 1000).toFixed(1)} s`}
            className="-rotate-2 self-start"
          >
            {formatAmount(step.cents)} is in {name}&apos;s account.
          </PassportStamp>
          <div>
            <h1 className={HEADLINE}>Sent to {name}</h1>
            <p className="text-muted-foreground mt-4 text-[1.0625rem] leading-relaxed">
              It arrived as local money, converted by Agora on the way. Only {name} can see it.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Link href="/app" className={cn(buttonVariants({ size: "lg" }), PRIMARY)}>
              Back to my account
            </Link>
            <Button
              variant="ghost"
              size="lg"
              className="h-12 rounded-full text-base"
              onClick={onFinished}
            >
              Send more
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  const self_ = self && to.account === self;
  return (
    <Shell>
      <div>
        <p className="text-muted-foreground text-[0.9375rem]">Send home</p>
        <h1 className={`${HEADLINE} mt-2`}>Send money to {name}</h1>
        {onChangeRecipient && (
          <button onClick={onChangeRecipient} className="mt-2 text-sm underline underline-offset-4">
            Someone else
          </button>
        )}
      </div>

      <form onSubmit={send} className="flex flex-1 flex-col gap-6">
        <div className="bg-card rounded-2xl p-6 shadow-[0_18px_40px_-28px_rgba(15,42,32,0.45)]">
          <label htmlFor="send-amount" className="text-muted-foreground text-sm">
            Amount
          </label>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="font-display text-4xl">$</span>
            <input
              id="send-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              className="font-display w-full bg-transparent text-5xl tabular-nums outline-none placeholder:text-foreground/25"
            />
          </div>
          <p className="text-muted-foreground mt-3 text-sm">
            {wallet
              ? `You can send up to ${formatUsd(wallet.spendable)}.`
              : "Counting your balance…"}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {[50, 100, 200].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setAmount(String(n))}
                className="border-foreground/25 hover:bg-secondary h-10 rounded-full border-[1.5px] px-4 text-sm font-semibold"
              >
                ${n}
              </button>
            ))}
          </div>
        </div>

        <ul className="text-muted-foreground flex flex-col gap-1.5 text-sm">
          <li className="flex gap-2">
            <Check aria-hidden="true" className="text-primary mt-0.5 size-4 shrink-0" />
            Arrives in seconds, converted by Agora at a fixed price.
          </li>
          <li className="flex gap-2">
            <Check aria-hidden="true" className="text-primary mt-0.5 size-4 shrink-0" />
            No fees for you. {name === "your family" ? "They" : name} can&apos;t see your balance.
          </li>
        </ul>

        <div className="mt-auto flex flex-col gap-3">
          {self_ && <ErrorNote>This is your own link. Send it to family instead.</ErrorNote>}
          <Button
            type="submit"
            size="lg"
            className={PRIMARY}
            disabled={!valid || !recipient || step.kind === "sending" || !!self_}
          >
            <HouseHeart aria-hidden="true" />
            {step.kind === "sending"
              ? "Sending…"
              : valid
                ? `Send ${formatAmount(cents)} to ${name}`
                : `Send to ${name}`}
          </Button>
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
      </form>
    </Shell>
  );
}
