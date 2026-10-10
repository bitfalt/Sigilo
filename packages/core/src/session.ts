// Sign-in challenge (SPEC.md §10 Auth). A worker's or employer admin's Mera EVM key signs this
// EIP-191 message inside the Mera session (no prompt); Convex verifies it and issues a session
// token whose subject is the lowercase address. Shared by the client and the Convex backend.

/** JWT audience (Convex `applicationID`). */
export const SESSION_AUDIENCE = "sigilo";
/** Challenges expire quickly; sessions last a working day. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface SessionChallenge {
  address: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

export function sessionChallengeMessage(c: SessionChallenge): string {
  return [
    "Sign in to Sigilo",
    "",
    `Account: ${c.address.toLowerCase()}`,
    `Nonce: ${c.nonce}`,
    `Issued At: ${new Date(c.issuedAt).toISOString()}`,
    `Expires At: ${new Date(c.expiresAt).toISOString()}`,
  ].join("\n");
}
