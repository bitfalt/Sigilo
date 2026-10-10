import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, test } from "vitest";

import { BN254_R } from "./constants";
import type { PassportPayslip } from "./passport";
import {
  attestationFor,
  attestationTypedData,
  currentPeriod,
  isRecent,
  isSigiloAttestation,
  requestNonce,
  selectPassportPayslips,
} from "./verify";

describe("requestNonce", () => {
  test("is a stable, non-zero field element", () => {
    const n = requestNonce("k57a1b2c3d4e5f6");
    expect(n).toBe(requestNonce("k57a1b2c3d4e5f6"));
    expect(n).toBeGreaterThan(0n);
    expect(n).toBeLessThan(BN254_R);
    expect(n).not.toBe(requestNonce("k57a1b2c3d4e5f7"));
  });
});

describe("periods", () => {
  test("current period and recency", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(currentPeriod(now)).toBe(2026 * 12 + 9);
    expect(isRecent(2026 * 12 + 8, now)).toBe(true); // September
    expect(isRecent(2026 * 12 + 7, now)).toBe(true); // August
    expect(isRecent(2026 * 12 + 6, now)).toBe(false); // July
  });
});

describe("selectPassportPayslips", () => {
  const slip = (employerId: string, period: number, gross: bigint) => ({
    employerId,
    payslip: {
      period,
      gross,
      salt: 0n,
      runRoot: 0n,
      runPath: { siblings: [], isRight: [] },
    } as PassportPayslip,
  });

  test("picks the newest consecutive window at or above the threshold", () => {
    const picked = selectPassportPayslips(
      [
        slip("0x01", 100, 2000n),
        slip("0x01", 101, 2000n),
        slip("0x01", 102, 2000n),
        slip("0x01", 103, 1000n), // below threshold breaks the newest window
        slip("0x02", 104, 1600n),
        slip("0x02", 105, 1600n),
        slip("0x02", 106, 1600n),
      ],
      1500n,
    );
    expect(picked?.map((p) => [p.employerId, p.payslip.period])).toEqual([
      ["0x02", 104],
      ["0x02", 105],
      ["0x02", 106],
    ]);
  });

  test("never mixes employers or skips a month", () => {
    expect(
      selectPassportPayslips(
        [slip("0x01", 100, 2000n), slip("0x02", 101, 2000n), slip("0x01", 102, 2000n)],
        1500n,
      ),
    ).toBeNull();
    expect(
      selectPassportPayslips(
        [slip("0x01", 100, 2000n), slip("0x01", 101, 2000n), slip("0x01", 103, 2000n)],
        1500n,
      ),
    ).toBeNull();
  });
});

describe("attestations", () => {
  const publicInputs = {
    registryRoot: 5n,
    periods: [24318, 24319, 24320],
    threshold: 150_000n,
    scope: 999n,
    nonce: 7n,
    pseudonym: 42n,
  };

  test("only the Sigilo operator's signature is accepted", async () => {
    const attestation = attestationFor(publicInputs, true, 1_791_000_000);
    expect(attestation).toMatchObject({ thresholdCents: 150_000, firstPeriod: 24318, months: 3 });

    const stranger = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const signature = await stranger.signTypedData(attestationTypedData(attestation));
    expect(await isSigiloAttestation({ attestation, signature })).toBe(false);
    expect(await isSigiloAttestation({ attestation, signature: "0x1234" })).toBe(false);
  });
});
