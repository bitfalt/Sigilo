import { recoverTypedDataAddress, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, test } from "vitest";

import {
  AUSD_TESTNET_DOMAIN,
  authorizationNonce,
  intentHash,
  PayAction,
  RECEIVE_WITH_AUTHORIZATION_TYPES,
} from "./intent";
import { derivePayslipKeypair, deriveStealthKeys } from "./keys";
import { decryptReceipt } from "./receipts";
import { MIN_SEND_AUSD, prepareSendHome } from "./send";
import { encodePaymentProfile, oneTimeAccountKey, paymentProfile } from "./stealth";

const MOM_PRF = Uint8Array.from({ length: 32 }, (_, i) => 100 + i);
const momStealth = deriveStealthKeys(MOM_PRF);
const momReceipts = derivePayslipKeypair(MOM_PRF);
const mom = {
  paymentProfile: encodePaymentProfile(paymentProfile(momStealth)),
  receiptPublicKey: toHex(momReceipts.publicKey),
};
const key = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;
const pieces = [
  { privateKey: key(1), balance: 1_000_000_000n }, // $1,000
  { privateKey: key(2), balance: 200_000_000n }, // $200
];
const oneToOne = async (ausd: bigint) => ausd * 10n ** 12n;

describe("prepareSendHome", () => {
  test("spends the right pieces, pays a fresh account of the recipient, and tells only them", async () => {
    const sent = await prepareSendHome({
      pieces,
      amount: 1_100_000_000n, // $1,100: the $1,000 piece and $100 of the $200 one
      recipient: mom,
      quote: oneToOne,
      from: "María",
      now: 1_791_000_000_000,
    });

    expect(sent.intent).toMatchObject({
      action: PayAction.SendHome,
      to: sent.account,
      total: 1_100_000_000n,
      minOut: (1_100n * 10n ** 18n * 995n) / 1000n,
      deadline: 1_791_000_600n,
    });
    expect(sent.auths.map((a) => a.value)).toEqual([1_000_000_000n, 100_000_000n]);

    // Each authorization is signed by its piece and bound to this intent.
    const hash = intentHash(sent.intent);
    for (const [i, auth] of sent.auths.entries()) {
      const owner = privateKeyToAccount(pieces[i]!.privateKey).address;
      expect(auth.from).toBe(owner);
      expect(auth.nonce).toBe(authorizationNonce(hash, owner));
      const signer = await recoverTypedDataAddress({
        domain: AUSD_TESTNET_DOMAIN,
        types: RECEIVE_WITH_AUTHORIZATION_TYPES,
        primaryType: "ReceiveWithAuthorization",
        message: auth,
        signature: auth.signature,
      });
      expect(signer).toBe(owner);
    }

    // Only the recipient can open the receipt, and its account is theirs.
    const receipt = decryptReceipt(sent.receipt, momReceipts.secretKey);
    expect(receipt).toMatchObject({
      kind: "transfer",
      from: "María",
      token: "CTK",
      intentHash: hash,
    });
    if (receipt.kind === "payslip") throw new Error("unexpected payslip");
    const owned = oneTimeAccountKey(momStealth, receipt.pieces[0]!.ephemeralPubKey);
    expect(owned.address).toBe(sent.account);
    expect(receipt.pieces[0]!.amount).toBe((1_100n * 10n ** 18n).toString());
  });

  test("refuses dust and overdrafts", async () => {
    const base = { pieces, recipient: mom, quote: oneToOne, from: "María" };
    await expect(prepareSendHome({ ...base, amount: MIN_SEND_AUSD - 1n })).rejects.toThrow(
      RangeError,
    );
    await expect(prepareSendHome({ ...base, amount: 1_300_000_000n })).rejects.toThrow(
      /insufficient/,
    );
  });
});
