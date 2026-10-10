// Deterministic demo scenario shared by the e2e test and the Foundry fixture generator: a
// verified employer ran payroll for three consecutive months, and the registry interleaves
// another employer's runs so the prover's runs are not the only leaves.

import {
  advanceNonce,
  commitment,
  type PassportPayslip,
  payrollLeaf,
  periodIndex,
  registryLeaf,
  runTree,
  vaultScope,
  verifierScope,
} from "@sigilo/core";

/** Stand-in verifier for fixtures; real scopes use the lender or vault address. */
export const DEMO_VERIFIER = "0x00000000000000000000000000000000DeaDBeef";
export const DEMO_CHAIN_ID = 10143;

/**
 * The advance proof fixture. AdvanceVaultProof.t.sol deploys the vault from `deployer` at nonce
 * 0 on chain 10143, so its address (and therefore its scope) is known offline:
 * `cast compute-address 0x00000000000000000000000000000000000A11CE --nonce 0`.
 * María asks for the full $450 (30% of $1,500) to a fresh account of hers.
 */
export const ADVANCE_FIXTURE = {
  deployer: "0x00000000000000000000000000000000000A11CE",
  vault: "0x6b182f1488E8EfEb2Eb298155ed5Bd7FF8A14042",
  chainId: DEMO_CHAIN_ID,
  recipient: "0x000000000000000000000000000000000000cafe",
  amount: 450_000_000n,
  deadline: 1_800_000_000n,
  salt: "0x5a17000000000000000000000000000000000000000000000000000000adface",
} as const;

/** The demo scenario proven for ADVANCE_FIXTURE's vault and request. */
export function advanceScenario() {
  const f = ADVANCE_FIXTURE;
  return demoScenario({
    scope: vaultScope(f.vault, f.chainId),
    nonce: advanceNonce(f.recipient, f.amount, f.deadline, f.salt),
  });
}

export function demoScenario(opts: { scope?: bigint; nonce?: bigint; threshold?: bigint } = {}) {
  const passportSecret = 0x0badc0ffee5eedn;
  const employerId = 0xac3e1abn;
  const otherEmployerId = 0xbee5n;
  const worker = commitment(passportSecret);
  const start = periodIndex({ year: 2026, month: 7 });

  const payslips: PassportPayslip[] = [];
  const registryLeaves: bigint[] = [];
  for (let k = 0; k < 3; k++) {
    const period = BigInt(start + k);
    const gross = 240_000n; // $2,400.00
    const salt = 1_000n + BigInt(k);
    const run = runTree([
      payrollLeaf(commitment(11n), employerId, period, 310_000n, 7n),
      payrollLeaf(worker, employerId, period, gross, salt),
      payrollLeaf(commitment(12n), employerId, period, 185_000n, 9n),
    ]);
    payslips.push({ period: start + k, gross, salt, runRoot: run.root, runPath: run.path(1) });

    const otherRun = runTree([payrollLeaf(commitment(13n), otherEmployerId, period, 500_000n, 5n)]);
    registryLeaves.push(registryLeaf(otherEmployerId, period, otherRun.root));
    registryLeaves.push(registryLeaf(employerId, period, run.root));
  }

  return {
    passportSecret,
    employerId,
    payslips,
    registryLeaves,
    threshold: opts.threshold ?? 150_000n, // $1,500.00
    scope: opts.scope ?? verifierScope(DEMO_VERIFIER, DEMO_CHAIN_ID),
    nonce: opts.nonce ?? 0x6e6f6e6365n,
  };
}
