// Convex session tokens (SPEC.md §10 Auth): the Mera signing session signs a one-time challenge
// (no prompt) and Convex returns a short-lived token. Tokens live in memory only.

import type { LocalAccount } from "viem";

import { CONVEX_SITE_URL } from "./config";

export interface SessionToken {
  token: string;
  expiresAt: number;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${CONVEX_SITE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Sign-in failed (${res.status})`);
  return (await res.json()) as T;
}

export async function signIn(account: LocalAccount): Promise<SessionToken> {
  const { nonce, message } = await post<{ nonce: string; message: string }>("/auth/challenge", {
    address: account.address,
  });
  const signature = await account.signMessage({ message });
  return post<SessionToken>("/auth/session", { address: account.address, nonce, signature });
}
