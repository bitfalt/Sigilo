// Node prover/verifier for the income passport (tests, fixtures and the server-side Verify API).
// Proofs use the EVM target (keccak transcript, ZK) so they verify against HonkVerifier.sol,
// which `scripts/build.sh` generates with `bb ... -t evm` from the same artifact.

import { readFileSync } from "node:fs";
import { cpus } from "node:os";

import { Barretenberg, type ProofData, UltraHonkBackend } from "@aztec/bb.js";
import { type CompiledCircuit, type InputMap, Noir } from "@noir-lang/noir_js";
import type { PassportCircuitInputs } from "@sigilo/core";

const ARTIFACT = new URL("../artifacts/income_passport.json", import.meta.url);
const EVM = { verifierTarget: "evm" } as const;

export type PassportProver = Awaited<ReturnType<typeof createPassportProver>>;

export async function createPassportProver(threads = Math.min(cpus().length, 8)) {
  const circuit = JSON.parse(readFileSync(ARTIFACT, "utf8")) as CompiledCircuit;
  const api = await Barretenberg.new({ threads });
  const noir = new Noir(circuit);
  const backend = new UltraHonkBackend(circuit.bytecode, api);

  return {
    api,
    /** Witness generation + proof. Throws if the inputs violate a circuit constraint. */
    async prove(inputs: PassportCircuitInputs): Promise<ProofData> {
      const { witness } = await noir.execute(inputs as unknown as InputMap);
      return backend.generateProof(witness, EVM);
    },
    verify(proof: ProofData): Promise<boolean> {
      return backend.verifyProof(proof, EVM);
    },
    destroy: () => api.destroy(),
  };
}

export const toHex = (bytes: Uint8Array): `0x${string}` =>
  `0x${Buffer.from(bytes).toString("hex")}`;
