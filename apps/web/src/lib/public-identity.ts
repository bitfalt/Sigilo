// Public identity cached on this device so the app can show a "locked" state after a reload
// (Mera's none | locked | unlocked pattern). Never secrets: unlocking always re-runs Face ID, and
// clearing it changes nothing but convenience (the stateless test).

export interface PublicIdentity {
  role: "worker" | "employer";
  credentialId: string;
  address: string;
  displayName: string;
}

const KEY = (role: PublicIdentity["role"]) => `sigilo:identity:${role}`;

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
    localStorage.setItem(KEY(identity.role), JSON.stringify(identity));
  } catch {
    // Private mode or blocked storage: the app still works, it just forgets the device.
  }
}

export function forgetIdentity(role: PublicIdentity["role"]): void {
  try {
    localStorage.removeItem(KEY(role));
  } catch {
    // Ignore.
  }
}
