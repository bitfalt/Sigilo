// What the Chainlink CRE "payday" workflow has confirmed (SigiloOracle, packages/cre): whether a
// payroll registry root was rebuilt independently from the public leaves, and whether an advance
// is behind on its installments. Public reads from Monad.

import { SIGILO_TESTNET } from "@sigilo/core/deployments";
import { type Address, type Hex, parseAbi } from "viem";

import { publicClient } from "./chain";

const oracleAbi = parseAbi([
  "function rootStatus(bytes32 root) view returns (uint256 checkedAt, uint256 leafCount, uint256 mismatchAt)",
  "function isLate(address vault, uint256 advanceId) view returns (bool)",
]);

export interface RootStatus {
  /** When Chainlink last confirmed it (null = not yet). */
  checkedAt: Date | null;
  leafCount: number;
  /** When a check failed (null = never). */
  mismatchAt: Date | null;
}

export async function rootStatus(root: Hex): Promise<RootStatus> {
  const [checkedAt, leafCount, mismatchAt] = await publicClient.readContract({
    address: SIGILO_TESTNET.sigiloOracle,
    abi: oracleAbi,
    functionName: "rootStatus",
    args: [root],
  });
  const date = (s: bigint) => (s === 0n ? null : new Date(Number(s) * 1000));
  return { checkedAt: date(checkedAt), leafCount: Number(leafCount), mismatchAt: date(mismatchAt) };
}

export function isLate(vault: Address, advanceId: bigint): Promise<boolean> {
  return publicClient.readContract({
    address: SIGILO_TESTNET.sigiloOracle,
    abi: oracleAbi,
    functionName: "isLate",
    args: [vault, advanceId],
  });
}
