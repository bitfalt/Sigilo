// Sigilo contracts on Monad testnet (chain 10143). Source of truth for the web app and scripts.
// Deployed 2026-10-09 by packages/contracts/script/Deploy.s.sol and verified on MonadVision
// (Sourcify). Redeploying means updating this file and the passport fixtures' expectations.

export const SIGILO_TESTNET = {
  /** Operator: 0x47855D8f060c1d949fb4b9DeccD8B7c333b95AfC (server-held OPERATOR key). */
  registry: "0xba306ac85e31D43b92bc1915fF84354A08140A8B",
  honkVerifier: "0xB2C7D31fd760e085D13c4D3FC40fAE3b40c56177",
  passportVerifier: "0x0e40B46A82a79C0a4b0A9957bBD32AE6B5a4B290",
  sigiloPay: "0xBeDbFae158ed456E546bC0eE2c2b1405F8AbB701",
} as const;

/** Multicall3 (standard address, verified on Monad testnet). */
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
