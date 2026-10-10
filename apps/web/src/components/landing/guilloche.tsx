// Guilloche rosette, the fine-line pattern printed on checks and banknotes to make them hard to
// forge. Generated at render time on the server (no images): a woven outer band of phase-shifted
// sine rings and an inner epitrochoid rosette. Lines draw in once on load (see landing.css).

import { styles } from "./styles";

const TAU = Math.PI * 2;

function polarPath(r: (t: number) => number, samples: number, cx: number, cy: number): string {
  let d = "";
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * TAU;
    const radius = r(t);
    const x = cx + radius * Math.cos(t);
    const y = cy + radius * Math.sin(t);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return `${d}Z`;
}

function epitrochoid(R: number, r: number, d: number, samples: number, c: number): string {
  // Closed when R / r is rational; with integers the curve closes after r / gcd(R, r) turns.
  const turns = r / gcd(R, r);
  let path = "";
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * TAU * turns;
    const x = c + (R + r) * Math.cos(t) - d * Math.cos(((R + r) / r) * t);
    const y = c + (R + r) * Math.sin(t) - d * Math.sin(((R + r) / r) * t);
    path += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return path;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

const SIZE = 400;
const C = SIZE / 2;

const band = Array.from({ length: 14 }, (_, j) => {
  const phase = (j / 14) * TAU;
  return polarPath(
    (t) => 168 + 14 * Math.sin(12 * t + phase) + 6 * Math.sin(36 * t - phase),
    480,
    C,
    C,
  );
});

const rosette = [
  epitrochoid(84, 12, 34, 900, C),
  epitrochoid(84, 12, 26, 900, C),
  epitrochoid(84, 12, 18, 900, C),
];

const inner = Array.from({ length: 8 }, (_, j) => {
  const phase = (j / 8) * TAU;
  return polarPath((t) => 52 + 9 * Math.sin(8 * t + phase), 240, C, C);
});

export function Guilloche({ className }: { className?: string }) {
  let index = 0;
  const line = (d: string, tone: "band" | "rosette" | "inner") => (
    <path
      key={index}
      d={d}
      pathLength={1}
      className={`${styles.line} ${styles[tone]}`}
      style={{ "--i": index++ } as React.CSSProperties}
    />
  );
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className={className} aria-hidden="true" focusable="false">
      <g fill="none">
        {band.map((d) => line(d, "band"))}
        {rosette.map((d) => line(d, "rosette"))}
        {inner.map((d) => line(d, "inner"))}
      </g>
    </svg>
  );
}
