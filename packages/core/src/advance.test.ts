import { hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, test } from "vitest";

import {
  advanceNonce,
  advanceOwed,
  type DeductionMandate,
  DEMO_ADVANCE_TERMS,
  installmentFor,
  mandateTypedData,
  maxAdvance,
  recoverMandateSigner,
  vaultScope,
} from "./advance";
import { BN254_R } from "./constants";
import { fieldToHex } from "./field";

// The advance proof fixture (packages/circuits/js/scenario.ts → ADVANCE_FIXTURE): a vault
// deployed by 0x...A11CE at nonce 0 on Monad testnet, and María's request for $450.
const VAULT = "0x6b182f1488E8EfEb2Eb298155ed5Bd7FF8A14042";
const REQUEST = {
  recipient: "0x000000000000000000000000000000000000cafe",
  amount: 450_000_000n,
  deadline: 1_800_000_000n,
  salt: "0x5a17000000000000000000000000000000000000000000000000000000adface",
} as const;

describe("advanceNonce", () => {
  test("matches AdvanceVault.nonceFor (cast keccak, test_nonceFor_matchesCoreVector)", () => {
    const n = advanceNonce(REQUEST.recipient, REQUEST.amount, REQUEST.deadline, REQUEST.salt);
    // keccak256 = 0x6c649eca…bd98a9a, which is >= r, so this also pins the reduction.
    expect(fieldToHex(n)).toBe(
      "0x0b9c01e4d9d6f3f84ba7495378aa0c6113528992baf012683f57ac9c5bd98a98",
    );
    expect(n).toBeLessThan(BN254_R);
  });

  test("changes with every bound field", () => {
    const base = advanceNonce(REQUEST.recipient, REQUEST.amount, REQUEST.deadline, REQUEST.salt);
    const thief = "0x000000000000000000000000000000000000beef";
    expect(advanceNonce(thief, REQUEST.amount, REQUEST.deadline, REQUEST.salt)).not.toBe(base);
    expect(
      advanceNonce(REQUEST.recipient, REQUEST.amount - 1n, REQUEST.deadline, REQUEST.salt),
    ).not.toBe(base);
    expect(
      advanceNonce(REQUEST.recipient, REQUEST.amount, REQUEST.deadline + 1n, REQUEST.salt),
    ).not.toBe(base);
  });
});

describe("vaultScope", () => {
  test("matches AdvanceVault.scope() for the fixture vault (cast keccak)", () => {
    expect(fieldToHex(vaultScope(VAULT))).toBe(
      "0x04763579447873d74fc0a45e42719b3baf508c59de176802eb027883abe8c825",
    );
    expect(vaultScope(VAULT, 10143)).toBe(vaultScope(VAULT));
    expect(vaultScope(VAULT, 143)).not.toBe(vaultScope(VAULT));
  });
});

describe("terms", () => {
  test("cap is maxRatioBps of the proven month, in AUSD base units", () => {
    expect(maxAdvance(150_000n, DEMO_ADVANCE_TERMS.maxRatioBps)).toBe(450_000_000n); // $450
    expect(maxAdvance(0n, 3000)).toBe(0n);
    expect(maxAdvance(240_000n, 10_000)).toBe(2_400_000_000n);
  });

  test("owed adds the fee, rounded up (same vectors as AdvanceVault.t.sol)", () => {
    const fee = DEMO_ADVANCE_TERMS.feeBps;
    expect(advanceOwed(450_000_000n, fee)).toBe(459_000_000n);
    expect(advanceOwed(1n, fee)).toBe(2n);
    expect(advanceOwed(49n, fee)).toBe(50n);
    expect(advanceOwed(50n, fee)).toBe(51n);
    expect(advanceOwed(51n, fee)).toBe(53n);
    expect(advanceOwed(100n, 0)).toBe(100n);
  });

  test("installments cover what is owed", () => {
    expect(installmentFor(459_000_000n, 2)).toBe(229_500_000n);
    expect(installmentFor(10n, 3)).toBe(4n);
    expect(installmentFor(10n, 1)).toBe(10n);
    expect(() => installmentFor(10n, 0)).toThrow(RangeError);
    expect(() => installmentFor(10n, 256)).toThrow(RangeError);
  });
});

describe("DeductionMandate", () => {
  const worker = privateKeyToAccount(`0x${"00".repeat(31)}01`);
  const mandate: DeductionMandate = {
    vault: VAULT,
    advanceId: 1n,
    installment: 229_500_000n,
    installments: 2,
    deadline: 1_800_000_000n,
  };

  test("signature matches an independent EIP-712 signer (cast wallet sign --data)", async () => {
    expect(worker.address).toBe("0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf");
    expect(hashTypedData(mandateTypedData(mandate))).toBe(
      "0xe1c4916a22f9bbdb802233d87afbf8e21711a85cdc01e75f5ed263eebef4601f",
    );
    const signature = await worker.signTypedData(mandateTypedData(mandate));
    expect(signature).toBe(
      "0xf5dcfd70548b6276e3f418635a7ef6f4626fc8d272685ec4d57ae465358738e52efbe8d33997558b89c2079d61d3dd63f0e8146450c47e15a0acca7259aab3e81b",
    );
  });

  test("recovers the signer, and only for the signed terms", async () => {
    const signature = await worker.signTypedData(mandateTypedData(mandate));
    expect(await recoverMandateSigner({ mandate, signature })).toBe(worker.address);
    expect(
      await recoverMandateSigner({
        mandate: { ...mandate, installment: mandate.installment * 2n },
        signature,
      }),
    ).not.toBe(worker.address);
  });
});
