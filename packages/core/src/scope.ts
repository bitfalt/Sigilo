// Verifier scope (SPEC.md §8): uint256(keccak256(abi.encode(verifier, chainId))) mod r.
// A worker's pseudonym is H(secret, scope), so each verifier sees a stable but unlinkable id.
// Solidity contracts (AdvanceVault) recompute this with `address(this)` and `block.chainid`.

import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import { BN254_R } from "./constants";

export function verifierScope(verifier: `0x${string}`, chainId: number | bigint): bigint {
  if (!/^0x[0-9a-fA-F]{40}$/.test(verifier)) throw new Error(`not an address: ${verifier}`);
  const encoded = new Uint8Array(64);
  encoded.set(hexToBytes(verifier.slice(2)), 12);
  encoded.set(hexToBytes(BigInt(chainId).toString(16).padStart(64, "0")), 32);
  return BigInt(`0x${bytesToHex(keccak_256(encoded))}`) % BN254_R;
}
