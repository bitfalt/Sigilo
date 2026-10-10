// Network and protocol constants shared by the web app, scripts and tests.
// Addresses come from vendor docs (see SPEC.md §11); verify on an explorer before moving value.

export const MONAD_TESTNET_CHAIN_ID = 10143;
export const MONAD_MAINNET_CHAIN_ID = 143;

/** BN254 scalar field modulus (Noir / UltraHonk field). */
export const BN254_R =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Agora Instant Settlement on Monad testnet (verified on-chain 2026-10-09). Swaps require an
 * approved swapper: `whitelister.setApprovedSwapper(address)` is self-service on testnet.
 * AUSD (6 decimals) supports ERC-3009; its EIP-712 domain name is "Agora Dollar", version "1",
 * even though `name()` returns "AUSD". CTK has 18 decimals and no faucet: get it by swapping.
 */
export const AGORA_TESTNET = {
  instantSettlementFactory: "0x8468587Af422ad440F58a57E955eCA6A970b5375",
  /** token0 = CTK, token1 = AUSD. Swaps and quotes are called on the pair. */
  ctkAusdPair: "0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae",
  whitelister: "0x7c10F56d6f04a51376393a1C3670e966863F6BD5",
  ausd: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
  ctk: "0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D",
  /** `requestFunds(address)` drips testnet AUSD. */
  ausdFaucet: "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C",
} as const;

/** AUSD on Monad mainnet (reference only; the hackathon runs on testnet). */
export const AUSD_MAINNET = "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a";

/** Number of consecutive payroll periods proven by the income passport circuit (SPEC.md §8). */
export const PASSPORT_PERIODS = 3;
/** Merkle depths for the run tree and the global registry tree (SPEC.md §7.2). */
export const RUN_TREE_DEPTH = 8;
export const REGISTRY_TREE_DEPTH = 16;
/**
 * Gross pay and passport thresholds are committed as u64 USD cents, independent of the payroll
 * token's decimals. Part of every payroll leaf: do not change.
 */
export const COMMITTED_AMOUNT_DECIMALS = 2;
