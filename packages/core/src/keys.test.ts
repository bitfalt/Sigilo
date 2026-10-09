import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, test } from "vitest";

import { BN254_R } from "./constants";
import {
  deriveAccountKeys,
  derivePassportSecret,
  deriveEvmPrivateKey,
  SALT_ACCOUNT,
  SALT_PASSPORT,
} from "./keys";

// Fixed fake PRF output (bytes 0x01..0x20). These vectors are a regression guard:
// if any of them changes, existing users would derive different accounts.
const PRF = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

describe("PRF salts", () => {
  test("are sha256 of the namespace labels", () => {
    expect(bytesToHex(SALT_ACCOUNT)).toBe(
      "49a1b27b3635de548768f3a0ed7a5f61b610409759bfc83a1f7bd9e3e5768a46",
    );
    expect(bytesToHex(SALT_PASSPORT)).toBe(
      "87bc2c2035f1f8dae8cac54c11a1cde44fcb51f5d90a7f98d4f2316181371252",
    );
  });
});

describe("account namespace", () => {
  const keys = deriveAccountKeys(PRF);

  test("EVM key is pinned (address 0x50B240678777451BEfd67B7e8c3b4366482ba8F9)", () => {
    expect(bytesToHex(keys.evmPrivateKey)).toBe(
      "7c56100e187f2845a35ce856646662dfc2024be2b4a150b45ad1f62564617128",
    );
  });

  test("Unlink seed is 64 pinned bytes", () => {
    expect(keys.unlinkSeed).toHaveLength(64);
    expect(bytesToHex(keys.unlinkSeed)).toBe(
      "2134827c374525d5d4b9982fe69aa0d71ef5212f8f57d9ab1b873b47f738c966" +
        "a041210f5cf62f1402e556751acf7e37afd3d3d1cff122af097eead30a002115",
    );
  });

  test("payslip public key is pinned", () => {
    expect(bytesToHex(keys.payslip.publicKey)).toBe(
      "00e71d4cd298a543aa1cfb92a1d289f08d59955832c97f46cebe54cb3f4eba5a",
    );
  });

  test("derived keys are independent of each other", () => {
    const hex = [keys.evmPrivateKey, keys.unlinkSeed.slice(0, 32), keys.payslip.secretKey].map(
      bytesToHex,
    );
    expect(new Set(hex).size).toBe(3);
  });

  test("derivation is deterministic", () => {
    expect(deriveAccountKeys(PRF)).toEqual(keys);
  });
});

describe("passport namespace", () => {
  test("passport secret is a pinned BN254 field element", () => {
    const secret = derivePassportSecret(PRF);
    expect(secret < BN254_R).toBe(true);
    expect(secret.toString(16)).toBe(
      "1ce7fa4cbfd286f5ddd688454fe3fc4bdd785b38314c6a9d21d6ec29277ce789",
    );
  });
});

test("rejects PRF outputs that are not 32 bytes", () => {
  expect(() => deriveEvmPrivateKey(new Uint8Array(31))).toThrow(/32-byte/);
});
