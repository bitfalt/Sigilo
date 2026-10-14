"use client";

// "Get money from family" (SPEC.md F8): a link (and QR) that opens Send home with this person as
// the recipient. It carries only the account id and a first name; each payment still lands in a
// fresh one-time account, so the link reveals nothing about what arrives.

import { Check, Copy, Share2 } from "lucide-react";
import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/app/app-shell";
import { useKeys } from "@/components/sigilo-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { useRegisteredAccount } from "@/components/worker/use-account";
import { WorkerUnlock } from "@/components/worker/worker-home";
import { loadIdentity } from "@/lib/public-identity";
import { cn } from "@/lib/utils";

const PILL =
  "h-11 rounded-full border-[1.5px] border-foreground bg-transparent px-5 text-[0.9375rem] font-semibold text-foreground hover:bg-secondary";

export function ReceiveMoney() {
  const keys = useKeys("worker");
  const account = useRegisteredAccount(keys);
  if (!keys) return <WorkerUnlock />;

  return (
    <AppShell
      action={
        <Link
          href="/app"
          className="rounded-sm text-[0.9375rem] font-medium underline underline-offset-4"
        >
          Done
        </Link>
      }
    >
      <div className="flex flex-1 flex-col gap-8 py-6">
        <div>
          <h1 className="font-display text-[2.25rem] leading-[1.05] text-balance sm:text-5xl">
            Get money from family
          </h1>
          <p className="text-muted-foreground mt-4 text-[1.0625rem] leading-relaxed text-pretty">
            Send this link to family who use Sigilo. They choose an amount and it lands in your
            account in seconds. They never see your balance or your other payments.
          </p>
        </div>
        {account ? (
          <ReceiveLink account={account} />
        ) : (
          <p className="text-muted-foreground">Getting your link…</p>
        )}
      </div>
    </AppShell>
  );
}

function ReceiveLink({ account }: { account: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Rendered on the client only (after unlocking), so window and device storage are available.
  const url = useMemo(() => {
    const name = loadIdentity("worker")?.displayName?.trim().slice(0, 40) ?? "";
    const link = new URL("/app/send", window.location.origin);
    link.searchParams.set("to", account);
    if (name) link.searchParams.set("name", name);
    return link.toString();
  }, [account]);

  useEffect(() => {
    if (!url) return;
    QRCode.toString(url, {
      type: "svg",
      margin: 0,
      errorCorrectionLevel: "M",
      color: { dark: "#0f2a20", light: "#0000" },
    }).then(setSvg, () => setSvg(null));
  }, [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function share() {
    try {
      await navigator.share({ title: "Send me money with Sigilo", url });
    } catch {
      // Dismissed.
    }
  }

  return (
    <div className="bg-card flex flex-col items-center gap-6 rounded-2xl p-6 shadow-[0_18px_40px_-28px_rgba(15,42,32,0.45)]">
      <div
        role="img"
        aria-label="QR code for your link"
        className="size-52 [&_svg]:h-full [&_svg]:w-full"
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
      <p className="text-muted-foreground w-full truncate text-center text-sm">{url}</p>
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
        {typeof navigator !== "undefined" && "share" in navigator && (
          <Button
            onClick={share}
            className={cn(buttonVariants({ size: "lg" }), "h-12 rounded-full px-6 font-semibold")}
          >
            <Share2 aria-hidden="true" />
            Share my link
          </Button>
        )}
        <Button variant="outline" onClick={copy} className={PILL}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </div>
  );
}
