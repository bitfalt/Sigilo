// Time to a ready account, measured on this device and shown once (Mera UX: taps + seconds). Kept
// in sessionStorage so it survives the redirect to /app; holds only timings, nothing secret.

const KEY = "sigilo.firstRun";

interface FirstRun {
  start: number;
  taps: number;
  ms?: number;
}

function read(): FirstRun | null {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "null") as FirstRun | null;
  } catch {
    return null;
  }
}

function write(run: FirstRun | null) {
  try {
    if (run) sessionStorage.setItem(KEY, JSON.stringify(run));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked: no metric, nothing else changes.
  }
}

/** The first tap: "Create my account". */
export function startFirstRun() {
  write({ start: Date.now(), taps: 1 });
}

/** Another passkey tap during onboarding (e.g. activating the Income Passport). */
export function tapFirstRun() {
  const run = read();
  if (run && run.ms === undefined) write({ ...run, taps: run.taps + 1 });
}

/** The account is ready. */
export function finishFirstRun() {
  const run = read();
  if (run && run.ms === undefined) write({ ...run, ms: Date.now() - run.start });
}

/** The finished measurement, once. */
export function takeFirstRun(): { ms: number; taps: number } | null {
  const run = read();
  if (run?.ms === undefined) return null;
  write(null);
  return { ms: run.ms, taps: run.taps };
}
