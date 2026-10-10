// Public identity cached on this device so the app can show a "locked" state after a reload
// (Mera's none | locked | unlocked pattern) and go straight to this device's passkey. Never
// secrets: unlocking always re-runs the biometric prompt, and clearing it only costs convenience
// (the stateless test signs in with a synced passkey instead).

import { useMemo, useSyncExternalStore } from "react";

import { biometricName } from "./webauthn-client";

export interface PublicIdentity {
  role: "worker" | "employer";
  credentialId: string;
  transports?: readonly string[];
  address: string;
  displayName: string;
}

const KEY = (role: PublicIdentity["role"]) => `sigilo:identity:${role}`;
const EVENT = "sigilo:identity";

export function loadIdentity(role: PublicIdentity["role"]): PublicIdentity | null {
  try {
    const raw = localStorage.getItem(KEY(role));
    return raw ? (JSON.parse(raw) as PublicIdentity) : null;
  } catch {
    return null;
  }
}

export function saveIdentity(identity: PublicIdentity): void {
  try {
    const previous = loadIdentity(identity.role);
    // Sign-in doesn't report transports; keep the ones recorded when the passkey was created.
    const transports =
      identity.transports ??
      (previous?.credentialId === identity.credentialId ? previous.transports : undefined);
    localStorage.setItem(
      KEY(identity.role),
      JSON.stringify({ ...identity, ...(transports ? { transports } : {}) }),
    );
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // Private mode or blocked storage: the app still works, it just forgets the device.
  }
}

export function forgetIdentity(role: PublicIdentity["role"]): void {
  try {
    localStorage.removeItem(KEY(role));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // Ignore.
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

/** The identity remembered on this device for `role` (null on the server and when unknown). */
export function useKnownIdentity(role: PublicIdentity["role"]): PublicIdentity | null {
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(KEY(role));
      } catch {
        return null;
      }
    },
    () => null,
  );
  return useMemo(() => (raw ? (JSON.parse(raw) as PublicIdentity) : null), [raw]);
}

/** "Face ID", "Touch ID", "fingerprint or face", "Windows Hello"… for button copy. */
export function useBiometricName(): string {
  return useSyncExternalStore(
    () => () => {},
    () => biometricName(navigator.userAgent, navigator.maxTouchPoints),
    () => "Face ID",
  );
}
