// Printed-paper pieces for the worker app: the account seal, the envelope flap, the payslip stub
// perforation and the Income Passport stamp. Same vocabulary as the landing (guilloche, security
// ink, tear-off lines); all SVG and CSS, no images.

import { type CSSProperties, type ReactNode, useId } from "react";

import { Guilloche } from "@/components/landing/guilloche";
import { SealMark } from "@/components/landing/seal-mark";

const TAU = Math.PI * 2;

/** The landing's rosette, inked with the app palette. `spin` turns it slowly while we wait. */
export function Rosette({
  className = "",
  spin = false,
  children,
}: {
  className?: string;
  spin?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={`relative ${className}`}
      style={{ "--guilloche": "#3f7f67", "--seal": "#2a3cb0" } as CSSProperties}
    >
      <Guilloche
        className={`absolute inset-0 h-full w-full ${spin ? "motion-safe:animate-[spin_48s_linear_infinite]" : ""}`}
      />
      {children && (
        <div className="absolute inset-0 flex items-center justify-center">{children}</div>
      )}
    </div>
  );
}

/** Ultramarine wax seal: the Sigilo rosette pressed into security ink. */
export function WaxSeal({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`bg-primary text-primary-foreground ring-card inline-flex items-center justify-center rounded-full shadow-[0_6px_14px_-6px_rgba(42,60,176,0.7)] ring-4 ${className}`}
    >
      <SealMark className="size-[68%]" />
    </span>
  );
}

// A jagged crack down the seal. The polygons reach past the box so the ring and shadow survive.
const CRACK = "49% 22%, 57% 46%, 46% 70%, 52% 125%";
const LEFT_HALF = `polygon(-25% -25%, 56% -25%, ${CRACK}, -25% 125%)`;
const RIGHT_HALF = `polygon(56% -25%, 125% -25%, 125% 125%, ${CRACK.split(", ").reverse().join(", ")})`;

/**
 * The wax seal, whole or broken in two: Advanced settings break it once the passkey confirms,
 * because what happens past that point is outside Sigilo's protection.
 */
export function SealBreak({ broken, className = "" }: { broken: boolean; className?: string }) {
  const half =
    "bg-primary text-primary-foreground ring-card absolute inset-0 flex items-center justify-center rounded-full shadow-[0_6px_14px_-6px_rgba(42,60,176,0.7)] ring-4 transition-transform duration-700 ease-[cubic-bezier(.2,.9,.25,1.15)] motion-reduce:transition-none";
  return (
    <span aria-hidden="true" className={`relative inline-block -rotate-12 ${className}`}>
      <span
        className={half}
        style={{
          clipPath: LEFT_HALF,
          transform: broken ? "translate(-14%, 6%) rotate(-16deg)" : undefined,
        }}
      >
        <SealMark className="size-[68%]" />
      </span>
      <span
        className={half}
        style={{
          clipPath: RIGHT_HALF,
          transform: broken ? "translate(12%, -4%) rotate(11deg)" : undefined,
        }}
      >
        <SealMark className="size-[68%]" />
      </span>
    </span>
  );
}

// Fine guilloche lines that fill the envelope flap (viewBox 400 x 80, stretched to fit).
const flapLines = Array.from({ length: 16 }, (_, j) => {
  const phase = (j / 16) * TAU * 3;
  let d = "";
  for (let i = 0; i <= 320; i++) {
    const x = (i / 320) * 400;
    const t = (i / 320) * TAU;
    const y = 2 + j * 4.6 + 2.4 * Math.sin(14 * t + phase) + 0.9 * Math.sin(42 * t - phase);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(2)}`;
  }
  return d;
});

/** The closed flap across the top of the pay envelope, with the seal sitting on its tip. */
export function EnvelopeFlap({ className = "" }: { className?: string }) {
  const clip = useId();
  return (
    <svg
      viewBox="0 0 400 80"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      className={`block w-full ${className}`}
    >
      <defs>
        <clipPath id={clip}>
          <path d="M0 0 L200 80 L400 0 Z" />
        </clipPath>
      </defs>
      <path d="M0 0 L200 80 L400 0 Z" className="fill-secondary/60" />
      <g clipPath={`url(#${clip})`} fill="none" stroke="#3f7f67" strokeOpacity="0.42">
        {flapLines.map((d, i) => (
          <path key={i} d={d} strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
        ))}
      </g>
      <path
        d="M0 0 L200 80 L400 0"
        fill="none"
        stroke="#0f2a20"
        strokeOpacity="0.16"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * Tear-off line of a payslip stub: a dotted rule with a half-circle notch cut into each edge.
 * The notches are painted in the page colour, so the parent needs `overflow-hidden`.
 */
export function StubPerforation({ className = "" }: { className?: string }) {
  return (
    <div role="presentation" className={`relative h-5 ${className}`}>
      <span className="bg-background absolute top-1/2 -left-2.5 size-5 -translate-y-1/2 rounded-full shadow-[inset_-1px_0_0_rgba(15,42,32,0.08)]" />
      <span className="bg-background absolute top-1/2 -right-2.5 size-5 -translate-y-1/2 rounded-full shadow-[inset_1px_0_0_rgba(15,42,32,0.08)]" />
      <div
        className="absolute inset-x-5 top-1/2 h-2 -translate-y-1/2 opacity-30"
        style={{
          backgroundImage: "radial-gradient(circle, #0f2a20 1.2px, transparent 1.5px)",
          backgroundSize: "10px 8px",
          backgroundRepeat: "repeat-x",
          backgroundPosition: "0 50%",
        }}
      />
    </div>
  );
}

/** Income Passport stamp: ultramarine ink, double rule, slightly rotated (as on the landing). */
export function PassportStamp({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`text-primary outline-primary rounded-[10px] border-2 border-current bg-[#f4f6ff] px-5 py-4 outline-1 outline-offset-[3px] outline-solid ${className}`}
    >
      <p className="font-wide text-xl leading-tight">{title}</p>
      <div className="mt-1.5 text-sm leading-snug">{children}</div>
    </div>
  );
}
