// Money this person sent home, kept on this device only. The relay never learns who sends, so
// the server can't list it; each account on the phone keeps its own list. Clearing the device
// loses the list, never the money.

import { useMemo, useSyncExternalStore } from "react";

export interface SentEntry {
  /** Who it went to, as named on their link. */
  name: string;
  cents: number;
  /** When it was delivered (ms since epoch). */
  at: number;
  /** How long delivery took. */
  ms: number;
}

const KEY = (account: string) => `sigilo:sent:${account.toLowerCase()}`;
const EVENT = "sigilo:sent";
const MAX = 50;
const EMPTY: SentEntry[] = [];

function read(account: string): string | null {
  try {
    return localStorage.getItem(KEY(account));
  } catch {
    return null;
  }
}

export function recordSent(account: string, entry: SentEntry): void {
  try {
    const list = JSON.parse(read(account) ?? "[]") as SentEntry[];
    localStorage.setItem(KEY(account), JSON.stringify([entry, ...list].slice(0, MAX)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // Blocked storage: the money still went out.
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

/** What `account` sent from this device, newest first. */
export function useSentHistory(account: string): SentEntry[] {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(account),
    () => null,
  );
  return useMemo(() => {
    try {
      return raw ? (JSON.parse(raw) as SentEntry[]) : EMPTY;
    } catch {
      return EMPTY;
    }
  }, [raw]);
}
