// Income checks this device answered, so the account screen can show a lender's advance offer
// after the person left the check's page. Only the check ids (public capabilities) are kept, on
// this device; the server never learns which account answered which check.

import { useMemo, useSyncExternalStore } from "react";

const KEY = "sigilo:answered-checks";
const EVENT = "sigilo:answered-checks";
const MAX = 20;
const EMPTY: string[] = [];

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberAnsweredCheck(id: string): void {
  try {
    const ids = JSON.parse(read() ?? "[]") as string[];
    localStorage.setItem(KEY, JSON.stringify([id, ...ids.filter((x) => x !== id)].slice(0, MAX)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // Blocked storage: the offer still shows on the check's own page.
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The checks answered on this device, newest first. */
export function useAnsweredChecks(): string[] {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  return useMemo(() => {
    try {
      return raw ? (JSON.parse(raw) as string[]) : EMPTY;
    } catch {
      return EMPTY;
    }
  }, [raw]);
}
