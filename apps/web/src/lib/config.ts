// Public runtime configuration (NEXT_PUBLIC_* only; never secrets).

export const RP_ID = process.env.NEXT_PUBLIC_RP_ID ?? "localhost";
export const RP_NAME = process.env.NEXT_PUBLIC_RP_NAME ?? "Sigilo";
export const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
export const CONVEX_SITE_URL = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "";
export const MONAD_RPC_URL =
  process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
export const EXPLORER_URL =
  process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://testnet.monadvision.com";
