// Generate a real income passport proof for the demo scenario and write it as a Foundry
// fixture (packages/contracts/test/fixtures/income_passport.json). Re-run after `pnpm build`
// whenever the circuit changes. Usage: pnpm prove:fixture
//
// Proofs are zero-knowledge, so the proof bytes change on every run; the public inputs are
// deterministic.

import { writeFileSync } from "node:fs";

import { buildPassportInputs, encodePassportPublicInputs, fieldToHex } from "@sigilo/core";

import { createPassportProver, toHex } from "../js/prover";
import { demoScenario } from "../js/scenario";

const OUT = new URL("../../contracts/test/fixtures/income_passport.json", import.meta.url);

const { inputs, publicInputs } = buildPassportInputs(demoScenario());
const prover = await createPassportProver();
try {
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

  const fixture = {
    proof: toHex(proof.proof),
    publicInputs: expected,
    registryRoot: fieldToHex(publicInputs.registryRoot),
  };
  writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(
    `proof: ${proof.proof.length} bytes, prove ${proveMs.toFixed(0)} ms, ` +
      `verify ${verifyMs.toFixed(0)} ms → ${OUT.pathname}`,
  );
} finally {
  await prover.destroy();
}
