import "server-only";

import { type Client, createClient, createPublicClient, type Hex, http } from "viem";
import { type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

// Server-held keys for the Verify API (operator) and the demo lender console (SPEC.md §3).
// Read lazily so `next build` never needs them; they never reach client bundles.

const rpcUrl = () =>
  process.env.MONAD_TESTNET_RPC_URL ??
  process.env.NEXT_PUBLIC_MONAD_RPC_URL ??
  monadTestnet.rpcUrls.default.http[0];

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export const operatorAccount = (): PrivateKeyAccount =>
  privateKeyToAccount(requireEnv("OPERATOR_PRIVATE_KEY") as Hex);

export const lenderAccount = (): PrivateKeyAccount =>
  privateKeyToAccount(requireEnv("LENDER_PRIVATE_KEY") as Hex);

/** Monad testnet client for the MPP methods (they sign and send with an explicit account). */
export const monadClient = (): Client =>
  createClient({ chain: monadTestnet, transport: http(rpcUrl()) });

export const publicClient = () =>
  createPublicClient({ chain: monadTestnet, transport: http(rpcUrl()) });
