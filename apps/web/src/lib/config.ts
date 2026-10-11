// Public runtime configuration (NEXT_PUBLIC_* only; never secrets).

export const RP_ID = process.env.NEXT_PUBLIC_RP_ID ?? "localhost";
export const RP_NAME = process.env.NEXT_PUBLIC_RP_NAME ?? "Sigilo";
export const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
/** HTTP actions (sign-in). `convex deploy` only sets the cloud URL, so derive it when missing. */
export const CONVEX_SITE_URL =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL ??
  CONVEX_URL.replace(/\.convex\.cloud\/?$/, ".convex.site");
export const MONAD_RPC_URL =
  process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";
export const EXPLORER_URL =
  process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://testnet.monadvision.com";
/** GraphQL endpoint of the Envio indexer (packages/indexer). Unset until it's deployed. */
export const ENVIO_GRAPHQL_URL = process.env.NEXT_PUBLIC_ENVIO_GRAPHQL_URL ?? "";
