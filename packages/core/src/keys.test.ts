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

  test("stealth spend and view keys are pinned", () => {
    expect(bytesToHex(keys.stealth.spendKey)).toBe(
      "3f997e6aff2b445aa22f3823f978a82906e84ba94a91ea0ead7fb233587a5430",
    );
    expect(bytesToHex(keys.stealth.viewKey)).toBe(
      "49e7b5bbc7ca13337bfaee8e6873bd2e511e370623d4b65b962e5a4225f8e052",
    );
  });

  test("payslip public key is pinned", () => {
    expect(bytesToHex(keys.payslip.publicKey)).toBe(
      "00e71d4cd298a543aa1cfb92a1d289f08d59955832c97f46cebe54cb3f4eba5a",
    );
  });

  test("derived keys are independent of each other", () => {
    const hex = [
      keys.evmPrivateKey,
      keys.stealth.spendKey,
      keys.stealth.viewKey,
      keys.payslip.secretKey,
    ].map(bytesToHex);
    expect(new Set(hex).size).toBe(4);
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
