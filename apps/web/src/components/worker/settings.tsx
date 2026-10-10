"use client";

// Settings (SPEC.md F10). The basics (the account's name, Lock) up top; Advanced below, closed.
// Advanced shows a warning, asks for "I understand", then a passkey step-up: the account
// namespace is evaluated again and must re-derive the unlocked account, or nothing opens. Past
// that point, and only there, technical words are allowed (SPEC.md §13): AUSD, addresses,
// private keys. Nothing new is persisted; the re-derived account key lives in memory until
// Advanced closes or the page goes away.

import { isMeraError } from "@category-labs/mera";
import { CollectDestinationError, collectDestination, prepareCollect } from "@sigilo/core/collect";
import { deriveEvmPrivateKey } from "@sigilo/core/keys";
import { ConvexHttpClient } from "convex/browser";
import { useQuery } from "convex/react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Download,
  KeyRound,
  Lock,
  MoveRight,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { type Address, toHex } from "viem";
import { privateKeyToAddress } from "viem/accounts";

import { AppShell, Perforation } from "@/components/app/app-shell";
import { useKeys, useSigilo } from "@/components/sigilo-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRegisteredAccount } from "@/components/worker/use-account";
import { PassportStamp, SealBreak } from "@/components/worker/worker-art";
import { WorkerUnlock } from "@/components/worker/worker-home";
import { ErrorNote } from "@/components/worker/worker-views";
import { CONVEX_URL, EXPLORER_URL } from "@/lib/config";
import { errorMessage } from "@/lib/errors";
import type { WorkerKeys } from "@/lib/identity";
import { buildKeyExport, downloadJson, keyExportFilename } from "@/lib/key-export";
import { getPrf, passkeyErrorMessage } from "@/lib/passkeys";
import { useKnownIdentity } from "@/lib/public-identity";
import { cn } from "@/lib/utils";
import { formatUsd, loadWallet, type OwnedPiece, type Wallet } from "@/lib/wallet";

import { api } from "../../../convex/_generated/api";

const PRIMARY =
  "h-13 w-full rounded-full text-base font-semibold hover:bg-primary/88 [&_svg:not([class*='size-'])]:size-5";
const PILL =
  "h-11 rounded-full border-[1.5px] border-foreground bg-transparent px-5 text-[0.9375rem] font-semibold text-foreground hover:bg-secondary [&_svg:not([class*='size-'])]:size-4.5";
const QUIET =
  "h-11 rounded-full px-4 text-[0.9375rem] font-medium text-foreground underline decoration-foreground/30 decoration-[1.5px] underline-offset-4 hover:bg-transparent hover:decoration-foreground";
const CARD = "bg-card rounded-2xl p-6 shadow-[0_18px_40px_-28px_rgba(15,42,32,0.45)]";
const CARD_TITLE = "font-wide text-xl leading-tight";
const BODY = "text-muted-foreground text-[0.9375rem] leading-relaxed text-pretty";
const CTK_PER_AUSD = 10n ** 12n;

export function Settings() {
  const keys = useKeys("worker");
  return keys ? <SettingsView keys={keys} /> : <WorkerUnlock />;
}

/** Receipts → pieces and balances; `reload()` re-reads the balances (after a move). */
function useWallet(keys: WorkerKeys) {
  const account = useRegisteredAccount(keys);
  const stored = useQuery(api.receipts.mine, account ? {} : "skip");
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!stored) return;
    let cancelled = false;
    loadWallet(stored, keys).then((w) => !cancelled && setWallet(w));
    return () => {
      cancelled = true;
    };
  }, [stored, keys, version]);
  return { wallet, reload: () => setVersion((v) => v + 1) };
}

function SettingsView({ keys }: { keys: WorkerKeys }) {
  const { lock } = useSigilo();
  const router = useRouter();
  const known = useKnownIdentity("worker");
  const { wallet, reload } = useWallet(keys);
  const name = known?.address === keys.address ? known.displayName.trim() : "";

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
      <div className="flex flex-1 flex-col gap-8 py-6">
        <h1 className="font-display text-[2.25rem] leading-[1.05] sm:text-5xl">Settings</h1>

        <section aria-labelledby="account-title" className={CARD}>
          <h2 id="account-title" className="text-muted-foreground text-sm">
            Account
          </h2>
          <p className="font-wide mt-1 text-2xl leading-tight break-words">
            {name || "Your account"}
          </p>
          <p className={`${BODY} mt-2`}>
            Opens with your passkey. Locking ends this session on this device; your passkey opens it
            again.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              lock();
              router.push("/app");
            }}
            className={`${PILL} mt-5`}
          >
            <Lock aria-hidden="true" />
            Lock
          </Button>
        </section>

        <Perforation />

        <Advanced keys={keys} credential={known} wallet={wallet} onMoved={reload} />
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------------------------
// Advanced: warning → I understand → passkey step-up → tools

function Advanced({
  keys,
  credential,
  wallet,
  onMoved,
}: {
  keys: WorkerKeys;
  credential: { credentialId: string; transports?: readonly string[]; address: string } | null;
  wallet: Wallet | null;
  onMoved(): void;
}) {
  const panel = useId();
  const [open, setOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  // The account's EVM key, re-derived by the step-up. Memory only; wiped when Advanced closes.
  const accountKey = useRef<Uint8Array | null>(null);

  function wipe() {
    accountKey.current?.fill(0);
    accountKey.current = null;
  }
  useEffect(
    () => () => {
      accountKey.current?.fill(0);
      accountKey.current = null;
    },
    [],
  );

  function toggle() {
    if (open) {
      wipe();
      setUnlocked(false);
      setUnderstood(false);
      setError(null);
    }
    setOpen(!open);
  }

  async function stepUp() {
    setBusy(true);
    setError(null);
    try {
      const sameAccount = credential?.address === keys.address ? credential : undefined;
      const { prf } = await getPrf("account", sameAccount);
      let key: Uint8Array;
      try {
        key = deriveEvmPrivateKey(prf);
      } finally {
        prf.fill(0);
      }
      if (privateKeyToAddress(toHex(key)) !== keys.address) {
        key.fill(0);
        setError("That passkey opens a different Sigilo account. Use the one you signed in with.");
        return;
      }
      wipe();
      accountKey.current = key;
      setUnlocked(true);
    } catch (e) {
      setError(
        isMeraError(e) && e.code === "PASSKEY_OPERATION_FAILED"
          ? "Your passkey didn’t confirm, so Advanced stays closed. Try again."
          : passkeyErrorMessage(e),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={`${panel}-title`} className="flex flex-col gap-5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panel}
        className="focus-visible:ring-ring/50 hover:bg-foreground/[0.03] -mx-2 flex min-h-16 items-center justify-between gap-4 rounded-xl px-2 text-left outline-none focus-visible:ring-3"
      >
        <span>
          <span id={`${panel}-title`} className="font-wide block text-xl">
            Advanced
          </span>
          <span className="text-muted-foreground mt-0.5 block text-sm">
            Take your money and your keys outside Sigilo
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-5 shrink-0 motion-safe:transition-transform motion-safe:duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div id={panel} className="flex flex-col gap-5">
          <div className={cn(CARD, "relative overflow-hidden pt-8")}>
            <VoidBand />
            <div className="flex items-start gap-4">
              <SealBreak broken={unlocked} className="mt-1 size-11 shrink-0" />
              <div>
                <h3 className="font-wide text-lg leading-tight">
                  {unlocked ? "Advanced tools are open" : "Outside Sigilo’s protection"}
                </h3>
                <p className={`${BODY} mt-2`}>
                  {unlocked
                    ? "They close when you leave this page or close Advanced. Nothing here was saved."
                    : "For people who manage their own digital-dollar accounts. Anything you move or export here leaves Sigilo’s protection: we can’t see it, get it back or undo it, and anyone who gets your keys can take your money."}
                </p>
              </div>
            </div>

            {!unlocked && (
              <div className="mt-6 flex flex-col gap-4">
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[0.9375rem] font-medium">
                  <input
                    id="advanced-understand"
                    type="checkbox"
                    checked={understood}
                    onChange={(e) => setUnderstood(e.target.checked)}
                    className="accent-primary focus-visible:ring-ring/50 size-5 shrink-0 rounded outline-none focus-visible:ring-3"
                  />
                  I understand
                </label>
                <Button
                  size="lg"
                  onClick={stepUp}
                  disabled={!understood || busy}
                  className={PRIMARY}
                >
                  {busy ? (
                    "Waiting for your passkey…"
                  ) : (
                    <>
                      <KeyRound aria-hidden="true" />
                      Confirm with passkey
                    </>
                  )}
                </Button>
                {error && <ErrorNote>{error}</ErrorNote>}
              </div>
            )}
          </div>

          {unlocked && (
            <>
              <MoveEverything keys={keys} wallet={wallet} onMoved={onMoved} />
              <ExportKeys keys={keys} accountKey={accountKey} wallet={wallet} />
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Cheque-style "void" hatching across the top of the warning: this paper isn't protected. */
function VoidBand() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-x-0 top-0 h-2.5 opacity-70"
      style={{
        backgroundImage:
          "repeating-linear-gradient(-45deg, var(--destructive) 0 6px, transparent 6px 12px)",
      }}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Move everything to another account (SigiloPay.collect)

type MoveStep =
  | { kind: "form" }
  | { kind: "review"; to: Address }
  | { kind: "moving"; to: Address; batch: number; of: number }
  | { kind: "done"; to: Address; moved: bigint; hashes: string[]; error?: string };

const sum = (pieces: readonly OwnedPiece[]) => pieces.reduce((s, p) => s + p.balance, 0n);

interface DestinationCheck {
  to: Address | null;
  /** Why the address can't be used (null while it's empty or still being typed). */
  message: string | null;
  note?: string | null;
}

function destinationCheck(input: string, own: readonly Address[], self: string): DestinationCheck {
  if (!input) return { to: null, message: null };
  try {
    const to = collectDestination(input, own);
    return {
      to,
      message: null,
      note:
        to === self
          ? "This is your Sigilo sign-in account. Sigilo won’t show money held there."
          : null,
    };
  } catch (e) {
    const reason = e instanceof CollectDestinationError ? e.message : "";
    // Still typing a well-formed prefix: no error yet.
    if (/invalid/.test(reason) && /^0x?[0-9a-fA-F]{0,39}$/.test(input)) {
      return { to: null, message: null };
    }
    const message = /checksum/.test(reason)
      ? "This address has a typo: its capital letters don’t match its checksum. Copy it again."
      : /personal/.test(reason)
        ? "That’s a contract (SigiloPay or a token). Money sent there would be stuck."
        : /own/.test(reason)
          ? "That’s one of your own one-time accounts. Choose an account outside Sigilo."
          : "Enter a full address: 0x followed by 40 letters and numbers.";
    return { to: null, message };
  }
}

function MoveEverything({
  keys,
  wallet,
  onMoved,
}: {
  keys: WorkerKeys;
  wallet: Wallet | null;
  onMoved(): void;
}) {
  const relay = useMemo(() => new ConvexHttpClient(CONVEX_URL), []);
  const [input, setInput] = useState("");
  const [step, setStep] = useState<MoveStep>({ kind: "form" });
  const [error, setError] = useState<string | null>(null);

  const ausd = wallet ? wallet.pieces.filter((p) => p.token === "AUSD" && p.balance > 0n) : [];
  const ctk = wallet ? wallet.pieces.filter((p) => p.token === "CTK" && p.balance > 0n) : [];
  const total = sum(ausd);
  const own = useMemo(() => (wallet ? wallet.pieces.map((p) => p.account) : []), [wallet]);
  const destination = destinationCheck(input.trim(), own, keys.address);

  function review(e: FormEvent) {
    e.preventDefault();
    if (destination.to && total > 0n) {
      setError(null);
      setStep({ kind: "review", to: destination.to });
    }
  }

  async function move(to: Address) {
    setError(null);
    setStep({ kind: "moving", to, batch: 0, of: 1 });
    const hashes: string[] = [];
    let moved = 0n;
    try {
      const { batches } = await prepareCollect({ pieces: ausd, to });
      for (const [i, { intent, auths }] of batches.entries()) {
        setStep({ kind: "moving", to, batch: i, of: batches.length });
        const { txHash } = await relay.action(api.transfers.collect, {
          auths: auths.map((a) => ({
            from: a.from,
            value: a.value.toString(),
            signature: a.signature,
          })),
          intent: {
            to: intent.to,
            total: intent.total.toString(),
            deadline: Number(intent.deadline),
            salt: intent.salt,
          },
        });
        hashes.push(txHash);
        moved += intent.total;
      }
      setStep({ kind: "done", to, moved, hashes });
    } catch (err) {
      const message = errorMessage(err, "The move didn’t go through. Nothing was moved.");
      if (hashes.length > 0) {
        setStep({ kind: "done", to, moved, hashes, error: `The rest didn’t move: ${message}` });
      } else {
        setStep({ kind: "review", to });
        setError(message);
      }
    } finally {
      onMoved();
    }
  }

  const ctkNote = ctk.length > 0 && (
    <p className="bg-secondary/70 text-foreground rounded-xl px-4 py-3 text-sm leading-relaxed">
      Money received from family ({formatUsd(sum(ctk) / CTK_PER_AUSD)}, held as CTK) can’t move this
      way: SigiloPay only moves AUSD. Use <strong className="font-semibold">Export keys</strong>{" "}
      below to take it with you.
    </p>
  );

  return (
    <section aria-labelledby="move-title" className={CARD}>
      <h3 id="move-title" className={CARD_TITLE}>
        Move everything to another account
      </h3>

      {step.kind === "done" ? (
        <div className="mt-5 flex flex-col gap-5" aria-live="polite">
          <PassportStamp title={`Moved ${formatUsd(step.moved)}`} className="-rotate-1 self-start">
            AUSD now at <AddressText address={step.to} short />
          </PassportStamp>
          <ul className="flex flex-col gap-1">
            {step.hashes.map((hash, i) => (
              <li key={hash}>
                <a
                  href={`${EXPLORER_URL}/tx/${hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-sm text-[0.9375rem] font-medium underline decoration-[1.5px] underline-offset-4"
                >
                  {step.hashes.length > 1 ? `Transaction ${i + 1}` : "View the transaction"} on
                  MonadVision
                  <ArrowUpRight aria-hidden="true" className="size-4" />
                </a>
              </li>
            ))}
          </ul>
          {step.error && <ErrorNote>{step.error}</ErrorNote>}
          {ctkNote}
        </div>
      ) : step.kind === "review" || step.kind === "moving" ? (
        <div className="mt-5 flex flex-col gap-5">
          <dl className="flex flex-col gap-4">
            <div>
              <dt className="text-muted-foreground text-sm">Amount</dt>
              <dd className="font-display mt-1 text-4xl tabular-nums">{formatUsd(total)}</dd>
              <dd className="text-muted-foreground mt-1 text-sm">
                AUSD from {ausd.length} one-time {ausd.length === 1 ? "account" : "accounts"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">To</dt>
              <dd className="mt-1">
                <AddressText address={step.to} />
              </dd>
            </div>
          </dl>
          <p className={BODY}>
            This can’t be undone. Check the address character by character: Sigilo can’t get the
            money back.
          </p>
          {step.kind === "moving" ? (
            <p aria-live="polite" className="font-wide text-primary text-lg">
              {step.of > 1
                ? `Moving your money… (payment ${step.batch + 1} of ${step.of})`
                : "Moving your money…"}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <Button size="lg" onClick={() => move(step.to)} className={PRIMARY}>
                <MoveRight aria-hidden="true" />
                Move {formatUsd(total)}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setError(null);
                  setStep({ kind: "form" });
                }}
                className={`${QUIET} self-center`}
              >
                Change address
              </Button>
            </div>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
      ) : (
        <form onSubmit={review} className="mt-3 flex flex-col gap-5">
          <p className={BODY}>
            Sends every AUSD balance in your one-time accounts to one address you control, through
            SigiloPay. Sigilo pays the network fee.
          </p>
          <p className="text-sm">
            {wallet === null ? (
              <span className="text-muted-foreground">Counting your one-time accounts…</span>
            ) : total > 0n ? (
              <>
                <span className="font-semibold">{formatUsd(total)} AUSD</span>{" "}
                <span className="text-muted-foreground">
                  in {ausd.length} one-time {ausd.length === 1 ? "account" : "accounts"}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">There’s no AUSD to move.</span>
            )}
          </p>
          {ctkNote}
          <div className="flex flex-col gap-2">
            <label htmlFor="move-to" className="text-sm font-semibold">
              Destination address
            </label>
            <Input
              id="move-to"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="0x…"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={destination.message ? true : undefined}
              aria-describedby="move-to-help"
              className="h-12 font-mono text-[0.9375rem]"
            />
            <div id="move-to-help" className="min-h-5 text-sm">
              {destination.to ? (
                <div className="flex flex-col gap-1">
                  <p className="text-primary flex items-center gap-1.5 font-medium">
                    <Check aria-hidden="true" className="size-4" />
                    Valid address. Compare it with the original:
                  </p>
                  <AddressText address={destination.to} />
                  {destination.note && (
                    <p className="text-muted-foreground mt-1">{destination.note}</p>
                  )}
                </div>
              ) : destination.message ? (
                <ErrorNote>{destination.message}</ErrorNote>
              ) : (
                <p className="text-muted-foreground">
                  An account you manage yourself, on Monad testnet.
                </p>
              )}
            </div>
          </div>
          <Button
            type="submit"
            size="lg"
            disabled={!destination.to || total === 0n}
            className={PRIMARY}
          >
            Review move
          </Button>
        </form>
      )}
    </section>
  );
}

/** An address in groups of four, so a person can compare it against the source. */
function AddressText({ address, short = false }: { address: string; short?: boolean }) {
  if (short) {
    return (
      <span className="font-mono" title={address}>
        {address.slice(0, 6)}…{address.slice(-4)}
      </span>
    );
  }
  // Two even rows of five groups under each other: 0x 1234 5678 9abc def0 1234 / 5678 …
  const groups = address.slice(2).match(/.{1,4}/g) ?? [];
  return (
    <span className="block font-mono text-[0.9375rem] leading-relaxed" title={address}>
      <span className="sr-only">{address}</span>
      <span aria-hidden="true" className="grid w-fit grid-cols-[repeat(6,auto)] gap-x-[0.6ch]">
        <span className="text-muted-foreground">0x</span>
        {groups.slice(0, 5).map((g, i) => (
          <span key={i}>{g}</span>
        ))}
        <span />
        {groups.slice(5).map((g, i) => (
          <span key={i + 5}>{g}</span>
        ))}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Export keys

function ExportKeys({
  keys,
  accountKey,
  wallet,
}: {
  keys: WorkerKeys;
  accountKey: RefObject<Uint8Array | null>;
  wallet: Wallet | null;
}) {
  const [step, setStep] = useState<"idle" | "confirm" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState("");

  function download() {
    setError(null);
    const key = accountKey.current;
    if (!key || !wallet) return;
    try {
      const name = keyExportFilename(keys.address);
      downloadJson(
        buildKeyExport({ keys, accountKey: key, pieces: wallet.pieces, explorerUrl: EXPLORER_URL }),
        name,
      );
      setFilename(name);
      setStep("done");
    } catch {
      setError("The file couldn’t be created. Nothing was saved; try again.");
    }
  }

  const contents: ReactNode[] = [
    "Your account’s address and private key",
    "The spend and view keys behind every one-time account",
    "The X25519 key that opens your payslips and receipts",
    wallet
      ? `Each one-time account’s token, address, private key and balance (${wallet.pieces.length})`
      : "Each one-time account’s token, address, private key and balance",
  ];

  return (
    <section aria-labelledby="export-title" className={CARD}>
      <h3 id="export-title" className={CARD_TITLE}>
        Export keys
      </h3>
      <p className={`${BODY} mt-3`}>
        Downloads a JSON file to this device with everything needed to use your money without
        Sigilo:
      </p>
      <ul className="mt-3 flex flex-col gap-1.5 text-[0.9375rem]">
        {contents.map((item, i) => (
          <li key={i} className="flex gap-2">
            <KeyRound aria-hidden="true" className="text-primary mt-1 size-4 shrink-0" />
            {item}
          </li>
        ))}
      </ul>

      {step === "idle" && (
        <Button
          variant="outline"
          onClick={() => setStep("confirm")}
          disabled={!wallet}
          className={`${PILL} mt-6`}
        >
          <Download aria-hidden="true" />
          {wallet ? "Export keys…" : "Counting your one-time accounts…"}
        </Button>
      )}

      {step === "confirm" && (
        <div
          role="group"
          aria-labelledby="export-confirm-title"
          className="border-destructive/40 bg-destructive/[0.04] mt-6 flex flex-col gap-4 rounded-xl border-[1.5px] p-4"
        >
          <p id="export-confirm-title" className="flex items-start gap-2 font-semibold">
            <TriangleAlert aria-hidden="true" className="text-destructive mt-0.5 size-5 shrink-0" />
            This file holds private keys in plain text.
          </p>
          <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed">
            <li>Anyone who opens it can move every balance in it and read your payslips.</li>
            <li>Sigilo doesn’t keep a copy and can’t take it back once it’s saved.</li>
            <li>Keep it offline or in a password manager. Don’t email or upload it.</li>
          </ul>
          <div className="flex flex-col gap-2">
            <Button size="lg" onClick={download} className={PRIMARY}>
              <Download aria-hidden="true" />
              Download keys file
            </Button>
            <Button
              variant="ghost"
              onClick={() => setStep("idle")}
              className={`${QUIET} self-center`}
            >
              Cancel
            </Button>
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
      )}

      {step === "done" && (
        <div className="mt-6 flex flex-col gap-2" aria-live="polite">
          <p className="flex items-start gap-2 font-semibold">
            <Check aria-hidden="true" className="text-primary mt-0.5 size-5 shrink-0" />
            Saved to your downloads
          </p>
          <p className="font-mono text-[0.8125rem] break-all">{filename}</p>
          <p className="text-muted-foreground text-sm">
            Sigilo didn’t keep a copy. Move the file somewhere safe.
          </p>
          <Button
            variant="ghost"
            onClick={() => setStep("confirm")}
            className={`${QUIET} -ml-4 self-start`}
          >
            Download again
          </Button>
        </div>
      )}
    </section>
  );
}
