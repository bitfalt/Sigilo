// The report the DON signs and the forwarder delivers to SigiloOracle.onReport.
// Must match packages/contracts/src/SigiloOracle.sol (_processReport); the tests pin the
// encoding on both sides.

import { encodeAbiParameters, type Hex, parseAbiParameters } from "viem";

export const REPORT_PARAMS = parseAbiParameters(
  "uint64 observedAt, (bytes32 root, uint32 leafCount, bool consistent)[] roots, (address vault, uint256 advanceId, uint32 period, bool late)[] installments",
);

export type RootCheck = { root: Hex; leafCount: number; consistent: boolean };
export type InstallmentStatus = { vault: Hex; advanceId: bigint; period: number; late: boolean };

export type PaydayReport = {
  /** DON consensus time, unix seconds. */
  observedAt: bigint;
  roots: RootCheck[];
  installments: InstallmentStatus[];
};

export function encodeReport(report: PaydayReport): Hex {
  return encodeAbiParameters(REPORT_PARAMS, [report.observedAt, report.roots, report.installments]);
}

// Gas for one forwarder delivery. Monad bills the gas limit, not the gas used, so the workflow
// sizes the limit to the report instead of using one large constant. Calibrated through the real
// MockKeystoneForwarder in packages/contracts/test/SigiloOracleFork.t.sol (measured on a Monad
// testnet fork: 1 root + 2 new late flags = 235k; 1 root + 64 = 2.21M).
export const GAS_BASE = 200_000n;
export const GAS_PER_ROOT = 100_000n;
export const GAS_PER_INSTALLMENT = 45_000n;

/** Gas limit for delivering `report` to SigiloOracle, worst case (every advance newly late). */
export function gasLimitFor(report: PaydayReport): bigint {
  return (
    GAS_BASE +
    GAS_PER_ROOT * BigInt(report.roots.length) +
    GAS_PER_INSTALLMENT * BigInt(report.installments.length)
  );
}

/**
 * An advance is late when it is still open and has repaid less than the installments due by now.
 * A closed advance (fully repaid) is never late.
 */
export function isLate(onchain: { active: boolean; repaid: bigint }, expectedRepaid: bigint) {
  return onchain.active && onchain.repaid < expectedRepaid;
}

/** Unix seconds of a DON time reading. */
export function unixSeconds(date: Date): bigint {
  return BigInt(Math.floor(date.getTime() / 1000));
}
