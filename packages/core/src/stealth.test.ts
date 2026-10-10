import { secp256k1 } from "@noble/curves/secp256k1.js";
import { recoverTypedDataAddress } from "viem";
import { describe, expect, test } from "vitest";

import {
  authorizationNonce,
  intentHash,
  type PayIntent,
  RECEIVE_WITH_AUTHORIZATION_TYPES,
  signIntentAuthorizations,
} from "./intent";
import { deriveStealthKeys } from "./keys";
import {
  centsToAusd,
  InsufficientFundsError,
  selectPieces,
  shuffled,
  splitIntoPieces,
} from "./pieces";
import {
  createOneTimeAccount,
  decodePaymentProfile,
  encodePaymentProfile,
  oneTimeAccountKey,
  paymentProfile,
} from "./stealth";

// Same fake PRF as keys.test.ts. Every value below was cross-checked with Foundry's `cast`
// (address of the owner key, abi.encode + keccak256 of the intent and nonce).
const PRF = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const keys = deriveStealthKeys(PRF);
const profile = paymentProfile(keys);
const EPHEMERAL = Uint8Array.from({ length: 32 }, () => 0x11);

const V = {
  profile:
    "0x0376846639f9f34571bc3f8a1a3225d8dd12fd76a81ff5f8951ea6d0e6e51aafa1" +
    "03b351cc98767412ce12bfe5bcad72ef863f62ce885f13b29b3390f9990aac9870",
  address: "0xC2FD88Ffc8c4032cdBfC7c14daC92CE72429C780",
  ephemeralPubKey: "0x034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa",
  ownerKey: "0x4952fe3a890722fb502f577ceb82eb981a3fee1c40e5c4e2cf6c05bb39f10dbe",
  intentHash: "0xb39f22020643db3dc65b9e8438b7e8bd51fa7f5ba41370d51d7eb477945940b0",
  nonce: "0x9e6210a1e36765c979160ccf95b69a263beb933efa270b296652e59ee405d61e",
};

describe("one-time accounts", () => {
  test("payment profile round-trips and is pinned", () => {
    expect(encodePaymentProfile(profile)).toBe(V.profile);
    expect(decodePaymentProfile(V.profile)).toEqual(profile);
    expect(() => decodePaymentProfile("0x1234")).toThrow();
    expect(() => decodePaymentProfile(`0x${"00".repeat(66)}`)).toThrow();
  });

  test("sender and owner derive the same pinned account", () => {
    const account = createOneTimeAccount(profile, EPHEMERAL);
    expect(account).toEqual({ address: V.address, ephemeralPubKey: V.ephemeralPubKey });
    expect(oneTimeAccountKey(keys, account.ephemeralPubKey)).toEqual({
      address: V.address,
      privateKey: V.ownerKey,
    });
  });

  test("every fresh account is new and recoverable by its owner", () => {
    const addresses = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const account = createOneTimeAccount(profile);
      addresses.add(account.address);
      expect(oneTimeAccountKey(keys, account.ephemeralPubKey).address).toBe(account.address);
    }
    expect(addresses.size).toBe(25);
  });

  test("another worker's keys cannot claim the account", () => {
    const other = deriveStealthKeys(PRF.map((b) => b ^ 0xff));
    const account = createOneTimeAccount(profile, EPHEMERAL);
    expect(oneTimeAccountKey(other, account.ephemeralPubKey).address).not.toBe(account.address);
  });

  test("the sender alone cannot spend: the address is not its ephemeral key's", () => {
    const account = createOneTimeAccount(profile, EPHEMERAL);
    const ephemeralAddress = oneTimeAccountKey(
      { spendKey: EPHEMERAL, viewKey: keys.viewKey },
      account.ephemeralPubKey,
    ).address;
    expect(ephemeralAddress).not.toBe(account.address);
    expect(secp256k1.utils.isValidSecretKey(EPHEMERAL)).toBe(true);
  });
});

describe("pieces", () => {
  test("splits salaries into 1-2-5 denominations", () => {
    expect(splitIntoPieces(240_000n)).toEqual([100_000n, 100_000n, 20_000n, 20_000n]);
    expect(splitIntoPieces(243_785n)).toEqual([
      100_000n,
      100_000n,
      20_000n,
      20_000n,
      2_000n,
      1_000n,
      500n,
      200n,
      50n,
      20n,
      10n,
      5n,
    ]);
    expect(splitIntoPieces(0n)).toEqual([]);
  });

  test("pieces always sum to the amount", () => {
    for (let i = 0; i < 200; i++) {
      const cents = BigInt(Math.floor(Math.random() * 2_000_000));
      expect(splitIntoPieces(cents).reduce((a, b) => a + b, 0n)).toBe(cents);
    }
  });

  test("cents convert to AUSD base units (6 decimals)", () => {
    expect(centsToAusd(240_000n)).toBe(2_400_000_000n);
  });

  test("selects the fewest pieces and spends the last one partially", () => {
    const pieces = [
      { id: "a", balance: 200n },
      { id: "b", balance: 1000n },
      { id: "c", balance: 500n },
    ];
    expect(selectPieces(pieces, 1200n)).toEqual([
      { id: "b", amount: 1000n },
      { id: "c", amount: 200n },
    ]);
    expect(selectPieces(pieces, 1700n)).toHaveLength(3);
    expect(() => selectPieces(pieces, 1701n)).toThrow(InsufficientFundsError);
    expect(() => selectPieces(pieces, 0n)).toThrow(RangeError);
  });

  test("shuffle keeps every item", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    expect([...shuffled(items)].sort((a, b) => a - b)).toEqual(items);
  });
});

describe("spend intents", () => {
  const intent: PayIntent = {
    action: 1,
    to: "0x00000000000000000000000000000000DeaDBeef",
    total: 2_400_000_000n,
    minOut: 2_390_000_000_000_000_000_000n,
    deadline: 1_800_000_000n,
    salt: `0x${"ab".repeat(32)}`,
  };

  test("intent hash and nonce match Solidity abi.encode", () => {
    const hash = intentHash(intent);
    expect(hash).toBe(V.intentHash);
    expect(authorizationNonce(hash, V.address as `0x${string}`)).toBe(V.nonce);
  });

  test("each piece signs a ReceiveWithAuthorization bound to the intent", async () => {
    const piece = oneTimeAccountKey(keys, V.ephemeralPubKey as `0x${string}`);
    const payee = "0x000000000000000000000000000000000000cafe";
    const [auth] = await signIntentAuthorizations({
      intent: { ...intent, total: 1_000n },
      pieces: [{ privateKey: piece.privateKey, amount: 1_000n }],
      payee,
    });
    expect(auth!.from).toBe(piece.address);
    expect(auth!.nonce).toBe(
      authorizationNonce(intentHash({ ...intent, total: 1_000n }), piece.address),
    );

    const { signature, ...message } = auth!;
    const signer = await recoverTypedDataAddress({
      domain: {
        name: "Agora Dollar",
        version: "1",
        chainId: 10143,
        verifyingContract: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
      },
      types: RECEIVE_WITH_AUTHORIZATION_TYPES,
      primaryType: "ReceiveWithAuthorization",
      message,
      signature,
    });
    expect(signer).toBe(piece.address);
  });

  test("refuses pieces that don't add up to the total", async () => {
    await expect(
      signIntentAuthorizations({
        intent,
        pieces: [{ privateKey: V.ownerKey as `0x${string}`, amount: 1n }],
        payee: "0x000000000000000000000000000000000000cafe",
      }),
    ).rejects.toThrow(/sum/);
  });
});
