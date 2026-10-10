// The worker's one balance, presented as a sealed pay envelope: a guilloche flap closed with the
// Sigilo seal, the amount in engraved figures and in words (as on a cheque), and a tear-off stub
// that holds the one primary action, Send home.

import { HouseHeart } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EnvelopeFlap, StubPerforation, WaxSeal } from "@/components/worker/worker-art";
import { formatUsd } from "@/lib/wallet";

/** `balance` in AUSD base units (6 decimals), or null while it is being counted. */
export function PayEnvelope({ balance }: { balance: bigint | null }) {
  const formatted = balance === null ? null : formatUsd(balance);
  const dot = formatted ? formatted.lastIndexOf(".") : -1;
  const dollars = formatted && dot > 0 ? formatted.slice(0, dot) : formatted;
  const cents = formatted && dot > 0 ? formatted.slice(dot) : "";

  return (
    <section
      aria-labelledby="balance-title"
      className="bg-card relative overflow-hidden rounded-xl shadow-[0_1px_0_rgba(15,42,32,0.06),0_28px_56px_-32px_rgba(15,42,32,0.55)]"
    >
      <div className="relative">
        <EnvelopeFlap className="h-16 sm:h-20" />
        <WaxSeal className="absolute top-16 left-1/2 size-14 -translate-x-1/2 -translate-y-1/2 -rotate-12 sm:top-20 sm:size-16" />
      </div>

      <div className="px-6 pt-10 pb-6 text-center sm:pt-12">
        <h2 id="balance-title" className="text-muted-foreground text-sm">
          Your balance
        </h2>
        {formatted === null ? (
          <p className="font-wide text-muted-foreground mt-4 mb-3 text-xl" aria-live="polite">
            Counting your balance…
          </p>
        ) : (
          <>
            <p className="font-display mt-2 text-[clamp(3rem,15vw,4.25rem)] tabular-nums">
              {dollars}
              <span className="ml-0.5 align-[0.62em] text-[0.42em] tracking-normal">{cents}</span>
            </p>
            <p className="border-foreground/15 text-muted-foreground mx-auto mt-4 max-w-[30ch] border-t pt-2 text-[0.8125rem] leading-snug text-balance">
              {amountInWords(Number(balance! / 10_000n))}
            </p>
          </>
        )}
        <p className="text-muted-foreground mt-4 text-xs">
          Digital dollars (AUSD). Only you can see this.
        </p>
      </div>

      <StubPerforation />

      <div className="px-6 pt-4 pb-6">
        <Link
          href="/app/send"
          className={cn(
            buttonVariants({ size: "lg" }),
            "hover:bg-primary/88 h-13 w-full rounded-full text-base font-semibold [&_svg:not([class*='size-'])]:size-5",
          )}
        >
          <HouseHeart aria-hidden="true" />
          Send home
        </Link>
        <p className="text-muted-foreground mt-2.5 text-center text-xs">
          To family abroad, delivered in seconds.{" "}
          <Link
            href="/app/receive"
            className="text-foreground rounded-sm font-medium underline decoration-[1.5px] underline-offset-4"
          >
            Get money from family
          </Link>
        </p>
      </div>
    </section>
  );
}

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = [
  [1_000_000_000, "billion"],
  [1_000_000, "million"],
  [1_000, "thousand"],
] as const;

function underThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(n % 10 ? `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}` : TENS[n / 10]!);
  } else if (n > 0) {
    parts.push(ONES[n]!);
  }
  return parts.join(" ");
}

function wholeInWords(n: number): string {
  if (n === 0) return ONES[0]!;
  const parts: string[] = [];
  for (const [size, name] of SCALES) {
    if (n >= size) {
      parts.push(`${underThousand(Math.floor(n / size))} ${name}`);
      n %= size;
    }
  }
  if (n > 0) parts.push(underThousand(n));
  return parts.join(" ");
}

/** "Two thousand four hundred and 00/100 dollars", the way a cheque writes it out. */
export function amountInWords(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  const words = wholeInWords(whole);
  return `${words[0]!.toUpperCase()}${words.slice(1)} and ${rest}/100 dollars`;
}
