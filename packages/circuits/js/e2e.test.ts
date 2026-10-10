import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  buildPassportInputs,
  decodePassportPublicInputs,
  encodePassportPublicInputs,
  poseidon2,
} from "@sigilo/core";

import { createPassportProver, type PassportProver } from "./prover";
import { demoScenario } from "./scenario";

let prover: PassportProver;
beforeAll(async () => {
  prover = await createPassportProver();
}, 60_000);
afterAll(() => prover?.destroy());

const toBytes = (x: bigint) =>
  Uint8Array.from(Buffer.from(x.toString(16).padStart(64, "0"), "hex"));
const fromBytes = (b: Uint8Array) => BigInt(`0x${Buffer.from(b).toString("hex")}`);

describe("Poseidon2: @sigilo/core vs Barretenberg", () => {
  test.each([[[1n, 2n]], [[5n, 7n, 9n]], [[4n, 777n, 24318n, 123n]], [[3n, 1n, 2n, 3n, 4n, 5n]]])(
    "arity %#",
    async (inputs) => {
      const { hash } = await prover.api.poseidon2Hash({ inputs: inputs.map(toBytes) });
      expect(fromBytes(hash)).toBe(poseidon2(inputs));
    },
  );
});

describe("income passport end to end", () => {
  test("witness builder → noir_js → bb.js (EVM target) proves and verifies", async () => {
    const { inputs, publicInputs } = buildPassportInputs(demoScenario());
    const proof = await prover.prove(inputs);

    expect(proof.publicInputs).toEqual(encodePassportPublicInputs(publicInputs));
    expect(decodePassportPublicInputs(proof.publicInputs)).toEqual(publicInputs);
    expect(await prover.verify(proof)).toBe(true);

    // Same proof, different claim: a higher threshold must not verify.
    const tampered = [...proof.publicInputs];
    tampered[4] = `0x${300_000n.toString(16).padStart(64, "0")}`;
    expect(await prover.verify({ ...proof, publicInputs: tampered })).toBe(false);
  }, 120_000);

  test("inputs that violate a constraint fail at witness generation", async () => {
    const { inputs } = buildPassportInputs(demoScenario());
    await expect(prover.prove({ ...inputs, threshold: "300000" })).rejects.toThrow();
  }, 60_000);
});
