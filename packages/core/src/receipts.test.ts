import { base64urlnopad } from "@scure/base";
import { describe, expect, test } from "vitest";

import { fieldToHex } from "./field";
import { commitment, payrollLeaf, registryLeaf } from "./hash";
import { derivePayslipKeypair } from "./keys";
import { runTree } from "./merkle";
import { buildPassportInputs } from "./passport";
import {
  decryptReceipt,
  encryptReceipt,
  type PayslipReceipt,
  payslipToPassportPayslip,
  ReceiptDecryptionError,
  type TransferReceipt,
} from "./receipts";

const PRF = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const recipient = derivePayslipKeypair(PRF);
const stranger = derivePayslipKeypair(PRF.map((b) => b ^ 0xff));

const transfer: TransferReceipt = {
  v: 1,
  kind: "transfer",
  from: "Mom",
  memo: "para el súper",
  token: "AUSD",
  pieces: [
    {
      account: "0xC2FD88Ffc8c4032cdBfC7c14daC92CE72429C780",
      ephemeralPubKey: "0x034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa",
      amount: "200000000",
    },
  ],
  txHash: `0x${"ab".repeat(32)}`,
  issuedAt: 1760000000000,
};

// Fixed ephemeral key (0x22…) and nonce (0x33…) for the pinned envelope.
const PINNED =
  "AQ-qaE7SiGe5f0pqLe5d-M6XTna3AY4_IqHEzyZ4Vw8gMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMz5XZSMzpfsJ2FWgePcOKBhYJLTi_z7KvUJtKGMYyuduWy2rII1YCDcJL6_8WDY4FO1L3oHsxCk2u-6Za3j11Pmr5FIDjzKIHYG0vxMSV51wtYj6TMxGevr6JjTX2LL96kBHZF2-JZfoSuiveBdDEFb3l-wAWwk9sE93zsyNwHaTHJDBIdg90QqKXVRUVU8neWhcc0dId7lUeU-6KQ4a5CR9DgVH9ogy_HyrhEydTVTGoRuONNij7tptU-PTaQ4gPJCTTsyjmLwGIfr7wYLEWtE51yH5QyQh_HPwoZUwH_W5VV6UkpBItGvoK_cJdBzGfA6lZ8pYy_t0dOOyLD9rtkJWJqPfl0AVH_OcPMyeE4B4R-JOfE3QBPK-GMLTym-86_CYp8HkzKRbjp2028yQdXqL251UF-tyhdB8nlzUZEHu8FufycmS5yYpcQMWd9Zp4qF-nczlDM45fZjwZJddjBdEU_P-Dx3Dnyuy4E8gLGA1_xznP0-WE";

const flip = (envelope: string, index: number) => {
  const bytes = base64urlnopad.decode(envelope);
  bytes[index]! ^= 0x01;
  return base64urlnopad.encode(bytes);
};

describe("receipt envelope", () => {
  test("is pinned for a fixed ephemeral key and nonce", () => {
    const envelope = encryptReceipt(transfer, recipient.publicKey, {
      ephemeralSecret: new Uint8Array(32).fill(0x22),
      nonce: new Uint8Array(24).fill(0x33),
    });
    expect(envelope).toBe(PINNED);
    expect(decryptReceipt(PINNED, recipient.secretKey)).toEqual(transfer);
  });

  test("round-trips with fresh randomness each time", () => {
    const a = encryptReceipt(transfer, recipient.publicKey);
    const b = encryptReceipt(transfer, recipient.publicKey);
    expect(a).not.toBe(b);
    expect(decryptReceipt(a, recipient.secretKey)).toEqual(transfer);
    expect(decryptReceipt(b, recipient.secretKey)).toEqual(transfer);
  });

  test("only the recipient can read it", () => {
    const envelope = encryptReceipt(transfer, recipient.publicKey);
    expect(() => decryptReceipt(envelope, stranger.secretKey)).toThrow(ReceiptDecryptionError);
  });

  test("any tampering is rejected", () => {
    // Version, ephemeral key, nonce and ciphertext bytes.
    for (const index of [0, 5, 40, 80, 120]) {
      expect(() => decryptReceipt(flip(PINNED, index), recipient.secretKey)).toThrow(
        ReceiptDecryptionError,
      );
    }
    expect(() => decryptReceipt(PINNED.slice(0, 60), recipient.secretKey)).toThrow(
      ReceiptDecryptionError,
    );
    expect(() => decryptReceipt("not base64 !!", recipient.secretKey)).toThrow(
      ReceiptDecryptionError,
    );
  });
});

describe("payslip → Income Passport", () => {
  test("a decrypted payslip feeds buildPassportInputs", () => {
    const secret = 0x1234567890abcdefn;
    const employerId = 777n;
    const c = commitment(secret);
    const receipts: PayslipReceipt[] = [24318, 24319, 24320].map((period, k) => {
      const salt = BigInt(11 + k);
      const run = runTree([
        payrollLeaf(42n, employerId, BigInt(period), 300_000n, 99n),
        payrollLeaf(c, employerId, BigInt(period), 240_000n, salt),
      ]);
      const path = run.path(1);
      return {
        v: 1,
        kind: "payslip",
        employer: { name: "Acme Labs", employerId: fieldToHex(employerId) },
        period,
        grossCents: "240000",
        deductions: [],
        netCents: "240000",
        token: "AUSD",
        pieces: [],
        payoutTxHash: `0x${"cd".repeat(32)}`,
        commitment: {
          salt: fieldToHex(salt),
          runRoot: fieldToHex(run.root),
          runPath: { siblings: path.siblings.map(fieldToHex), isRight: path.isRight },
        },
        issuedAt: 1760000000000,
      };
    });

    const decrypted = receipts
      .map((r) => encryptReceipt(r, recipient.publicKey))
      .map((e) => decryptReceipt(e, recipient.secretKey) as PayslipReceipt);
    const payslips = decrypted.map(payslipToPassportPayslip);

    const { publicInputs } = buildPassportInputs({
      passportSecret: secret,
      employerId,
      payslips,
      registryLeaves: payslips.map((p) => registryLeaf(employerId, BigInt(p.period), p.runRoot)),
      threshold: 150_000n,
      scope: 999n,
      nonce: 1n,
    });
    expect(publicInputs.periods).toEqual([24318, 24319, 24320]);
  });
});
