// Generate real income passport proofs for the demo scenario and write them as Foundry fixtures:
//   - packages/contracts/test/fixtures/income_passport.json (stand-in verifier scope)
//   - packages/contracts/test/fixtures/advance_proof.json (AdvanceVault scope, and a nonce bound
//     to ADVANCE_FIXTURE's recipient, amount, deadline and salt)
// Re-run after `pnpm build` whenever the circuit changes. Usage: pnpm prove:fixture
//
// Proofs are zero-knowledge, so the proof bytes change on every run; the public inputs are
// deterministic.

import { writeFileSync } from "node:fs";

import {
  buildPassportInputs,
  encodePassportPublicInputs,
  fieldToHex,
  type PassportPublicInputs,
} from "@sigilo/core";

import { createPassportProver, type PassportProver, toHex } from "../js/prover";
import { ADVANCE_FIXTURE, advanceScenario, demoScenario } from "../js/scenario";

const FIXTURES = new URL("../../contracts/test/fixtures/", import.meta.url);

async function prove(
  prover: PassportProver,
  scenario: ReturnType<typeof demoScenario>,
): Promise<{ proof: `0x${string}`; publicInputs: `0x${string}`[]; p: PassportPublicInputs }> {
  const { inputs, publicInputs } = buildPassportInputs(scenario);
  let t = performance.now();
  const proof = await prover.prove(inputs);
  const proveMs = performance.now() - t;

  t = performance.now();
  if (!(await prover.verify(proof))) throw new Error("bb.js rejected its own proof");
  const verifyMs = performance.now() - t;

  const expected = encodePassportPublicInputs(publicInputs);
  if (JSON.stringify(proof.publicInputs) !== JSON.stringify(expected)) {
    throw new Error("public inputs differ from the witness builder's encoding");
  }
  console.log(
    `proof: ${proof.proof.length} bytes, prove ${proveMs.toFixed(0)} ms, ` +
      `verify ${verifyMs.toFixed(0)} ms`,
  );
  return { proof: toHex(proof.proof), publicInputs: expected, p: publicInputs };
}

function write(name: string, fixture: object) {
  const out = new URL(name, FIXTURES);
  writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`→ ${out.pathname}`);
}

const prover = await createPassportProver();
try {
  const passport = await prove(prover, demoScenario());
  write("income_passport.json", {
    proof: passport.proof,
    publicInputs: passport.publicInputs,
    registryRoot: fieldToHex(passport.p.registryRoot),
  });

  const advance = await prove(prover, advanceScenario());
  const f = ADVANCE_FIXTURE;
  write("advance_proof.json", {
    proof: advance.proof,
    publicInputs: advance.publicInputs,
    registryRoot: fieldToHex(advance.p.registryRoot),
    deployer: f.deployer,
    vault: f.vault,
    chainId: f.chainId,
    scope: fieldToHex(advance.p.scope),
    recipient: f.recipient,
    // Decimal strings: vm.parseJsonUint reads them, and JSON numbers lose precision past 2^53.
    amount: f.amount.toString(),
    deadline: f.deadline.toString(),
    salt: f.salt,
    nonce: fieldToHex(advance.p.nonce),
  });
} finally {
  await prover.destroy();
}
