// Small rosette used as the Sigilo mark next to the wordmark.

const TAU = Math.PI * 2;

const rosette = (() => {
  // Epitrochoid with R = 7, r = 1 (closes in one turn): a 8-lobed seal.
  const R = 7;
  const r = 1;
  const d = 3.2;
  let path = "";
  for (let i = 0; i <= 160; i++) {
    const t = (i / 160) * TAU;
    const x = 16 + (R + r) * Math.cos(t) - d * Math.cos(((R + r) / r) * t);
    const y = 16 + (R + r) * Math.sin(t) - d * Math.sin(((R + r) / r) * t);
    path += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return path;
})();

export function SealMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="14.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d={rosette} fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}
