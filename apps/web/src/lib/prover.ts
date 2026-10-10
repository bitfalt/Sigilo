// In-browser Income Passport proving (SPEC.md F5). The passport secret is a private input, so the
// proof must be generated on the worker's device. noir_js computes the witness (WASM, fast) and
// bb.js proves in its own Web Worker (UltraHonk, EVM target so IncomePassportVerifier can check it
// on-chain). Both load on demand so the ~8 MB of WASM stays out of the app bundle. Without
// cross-origin isolation bb.js runs single-threaded, which is fine for this circuit size.

import type { PassportCircuitInputs } from "@sigilo/core/passport";

export interface PassportProof {
  /** 0x-hex proof bytes. */
  proof: `0x${string}`;
  /** bytes32 public inputs in circuit order. */
  publicInputs: string[];
  /** Milliseconds spent proving (for the demo's "seconds on a phone" claim). */
  provingMs: number;
}

export async function provePassport(inputs: PassportCircuitInputs): Promise<PassportProof> {
  const [{ Noir }, { Barretenberg, UltraHonkBackend }, circuit] = await Promise.all([
    import("@noir-lang/noir_js"),
    import("@aztec/bb.js"),
    import("@sigilo/circuits/income_passport.json"),
  ]);
  const compiled = (circuit as { default?: unknown }).default ?? circuit;
  const started = performance.now();
  const noir = new Noir(compiled as ConstructorParameters<typeof Noir>[0]);
  const { witness } = await noir.execute(inputs as unknown as Parameters<typeof noir.execute>[0]);

  const threads = typeof navigator !== "undefined" ? Math.min(navigator.hardwareConcurrency || 1, 8) : 1;
  const api = await Barretenberg.new({ threads });
  try {
    const backend = new UltraHonkBackend((compiled as { bytecode: string }).bytecode, api);
    const { proof, publicInputs } = await backend.generateProof(witness, { verifierTarget: "evm" });
    const hex = Array.from(proof, (b) => b.toString(16).padStart(2, "0")).join("");
    return {
      proof: `0x${hex}`,
      publicInputs,
      provingMs: Math.round(performance.now() - started),
    };
  } finally {
    await api.destroy();
  }
}
