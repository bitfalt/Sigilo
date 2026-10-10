import { getAddress, recoverTypedDataAddress } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { describe, expect, test } from "vitest";

import {
  COLLECT_DEADLINE_SECONDS,
  COLLECT_MAX_PIECES,
  CollectDestinationError,
  collectDestination,
  prepareCollect,
} from "./collect";
import { AGORA_TESTNET } from "./constants";
import { SIGILO_TESTNET } from "./deployments";
import {
  AUSD_TESTNET_DOMAIN,
  authorizationNonce,
  intentHash,
  PayAction,
  RECEIVE_WITH_AUTHORIZATION_TYPES,
} from "./intent";

const key = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;
const external = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";
const NOW = 1_791_000_000_000;

describe("prepareCollect", () => {
  test("moves every piece with a balance to the external account, bound to one intent", async () => {
    const pieces = [
      { privateKey: key(1), balance: 1_000_000_000n }, // $1,000
      { privateKey: key(2), balance: 0n }, // spent: skipped
      { privateKey: key(3), balance: 200_000_000n }, // $200
      { privateKey: key(4), balance: 10_000n }, // $0.01
    ];
    const { total, batches } = await prepareCollect({
      pieces,
      to: external.toLowerCase(),
      now: NOW,
    });

    expect(total).toBe(1_200_010_000n);
    expect(batches).toHaveLength(1);
    const [{ intent, auths }] = batches as [(typeof batches)[number]];
    expect(intent).toMatchObject({
      action: PayAction.Collect,
      to: external, // checksummed
      total: 1_200_010_000n,
      minOut: 0n,
      deadline: BigInt(NOW / 1000 + COLLECT_DEADLINE_SECONDS),
    });
    expect(intent.salt).toMatch(/^0x[0-9a-f]{64}$/);
    expect(auths.map((a) => a.value)).toEqual([1_000_000_000n, 200_000_000n, 10_000n]);

    // Each authorization is signed by its piece, pays SigiloPay, and is bound to this intent.
    const hash = intentHash(intent);
    const signers = [key(1), key(3), key(4)].map((k) => privateKeyToAddress(k));
    for (const [i, auth] of auths.entries()) {
      expect(auth.from).toBe(signers[i]);
      expect(auth.to).toBe(SIGILO_TESTNET.sigiloPay);
      expect(auth.validAfter).toBe(0n);
      expect(auth.validBefore).toBe(intent.deadline);
      expect(auth.nonce).toBe(authorizationNonce(hash, signers[i]!));
      const signer = await recoverTypedDataAddress({
        domain: AUSD_TESTNET_DOMAIN,
        types: RECEIVE_WITH_AUTHORIZATION_TYPES,
        primaryType: "ReceiveWithAuthorization",
        message: auth,
        signature: auth.signature,
      });
      expect(signer).toBe(signers[i]);
    }
  });

  test("splits into SigiloPay-sized batches, each its own intent", async () => {
    const pieces = Array.from({ length: 2 * COLLECT_MAX_PIECES + 2 }, (_, i) => ({
      privateKey: key(i + 1),
      balance: BigInt(i + 1) * 1_000_000n,
    }));
    const { total, batches } = await prepareCollect({ pieces, to: external, now: NOW });

    expect(batches.map((b) => b.auths.length)).toEqual([64, 64, 2]);
    expect(total).toBe(pieces.reduce((s, p) => s + p.balance, 0n));
    for (const { intent, auths } of batches) {
      expect(intent.total).toBe(auths.reduce((s, a) => s + a.value, 0n));
      const hash = intentHash(intent);
      for (const auth of auths) expect(auth.nonce).toBe(authorizationNonce(hash, auth.from));
    }
    expect(new Set(batches.map((b) => b.intent.salt)).size).toBe(3);
    expect(new Set(batches.flatMap((b) => b.auths.map((a) => a.from))).size).toBe(pieces.length);
  });

  test("signs a repeated piece only once", async () => {
    const { batches } = await prepareCollect({
      pieces: [
        { privateKey: key(7), balance: 5_000_000n },
        { privateKey: key(7), balance: 5_000_000n },
      ],
      to: external,
      now: NOW,
    });
    expect(batches[0]!.auths).toHaveLength(1);
    expect(batches[0]!.intent.total).toBe(5_000_000n);
  });

  test("refuses when there is nothing to move", async () => {
    await expect(
      prepareCollect({ pieces: [{ privateKey: key(1), balance: 0n }], to: external }),
    ).rejects.toThrow(RangeError);
  });

  test("refuses a destination that is one of the pieces", async () => {
    const own = privateKeyToAddress(key(1));
    await expect(
      prepareCollect({ pieces: [{ privateKey: key(1), balance: 1n }], to: own }),
    ).rejects.toThrow(CollectDestinationError);
  });
});

describe("collectDestination", () => {
  test("checksums valid addresses", () => {
    expect(collectDestination(external.toLowerCase())).toBe(external);
    expect(collectDestination(external)).toBe(getAddress(external));
  });

  test("rejects malformed and mistyped addresses", () => {
    expect(() => collectDestination("0x1234")).toThrow(/invalid/);
    expect(() => collectDestination(external.slice(2))).toThrow(/invalid/);
    // One letter's case flipped: a typo the checksum catches.
    const typo = `${external.slice(0, 3)}B${external.slice(4)}`;
    expect(() => collectDestination(typo)).toThrow(/checksum/);
  });

  test("rejects contracts that would trap the money and the person's own accounts", () => {
    for (const trap of [
      SIGILO_TESTNET.sigiloPay,
      AGORA_TESTNET.ausd,
      AGORA_TESTNET.ctk,
      "0x0000000000000000000000000000000000000000",
    ]) {
      expect(() => collectDestination(trap)).toThrow(CollectDestinationError);
    }
    const own = privateKeyToAddress(key(9));
    expect(() => collectDestination(own.toLowerCase(), [own])).toThrow(/own/);
  });
});
