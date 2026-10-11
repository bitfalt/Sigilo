// Sigilo contracts on Monad testnet (chain 10143). Source of truth for the web app and scripts.
// Deployed 2026-10-09 by packages/contracts/script/Deploy.s.sol and verified on MonadVision
// (Sourcify). Redeploying means updating this file and the passport fixtures' expectations.

export const SIGILO_TESTNET = {
  /** Operator: 0x47855D8f060c1d949fb4b9DeccD8B7c333b95AfC (server-held OPERATOR key). */
  registry: "0xba306ac85e31D43b92bc1915fF84354A08140A8B",
  honkVerifier: "0xB2C7D31fd760e085D13c4D3FC40fAE3b40c56177",
  passportVerifier: "0x0e40B46A82a79C0a4b0A9957bBD32AE6B5a4B290",
  sigiloPay: "0xBeDbFae158ed456E546bC0eE2c2b1405F8AbB701",
  /** Demo lender's vault (Fondo Quincena), deployed 2026-10-10: 30% cap, 2% fee. */
  advanceVault: "0xdB38A7F37f45934A42f4ddD740d8F69414de7734",
  /**
   * Consumer of the Chainlink CRE "payday" workflow (packages/cre), deployed 2026-10-11. Trusts
   * the Monad testnet MockKeystoneForwarder (simulation broadcasts).
   */
  sigiloOracle: "0xA2750a6aa2cCaD241e2c8d21d06C8C19e789890D",
} as const;

/** Multicall3 (standard address, verified on Monad testnet). */
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
