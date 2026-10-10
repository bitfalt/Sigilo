"use client";

// Dev-only smoke test for in-browser proving: builds the circuit fixture's inputs with
// @sigilo/core and proves them with noir_js + bb.js. Open /dev-preview/prover in `pnpm dev`.

import { commitment, payrollLeaf, registryLeaf } from "@sigilo/core/hash";
import { runTree } from "@sigilo/core/merkle";
import { buildPassportInputs, type PassportPayslip } from "@sigilo/core/passport";
import { notFound } from "next/navigation";
import { useState } from "react";

import { type PassportProof, provePassport } from "@/lib/prover";

function fixtureInputs() {
  const secret = 0x1234567890abcdefn;
  const employerId = 777n;
  const c = commitment(secret);
  const payslips: PassportPayslip[] = [24318, 24319, 24320].map((period, k) => {
    const salt = BigInt(11 + k);
    const run = runTree([
      payrollLeaf(42n, employerId, BigInt(period), 300_000n, 99n),
      payrollLeaf(c, employerId, BigInt(period), 240_000n, salt),
    ]);
    return { period, gross: 240_000n, salt, runRoot: run.root, runPath: run.path(1) };
  });
  return buildPassportInputs({
    passportSecret: secret,
    employerId,
    payslips,
    registryLeaves: payslips.map((p) => registryLeaf(employerId, BigInt(p.period), p.runRoot)),
    threshold: 150_000n,
    scope: 999n,
    nonce: 7n,
  }).inputs;
}

export default function ProverPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  const [state, setState] = useState<string>("idle");
  const [result, setResult] = useState<PassportProof | null>(null);

  async function run() {
    setState("proving");
    try {
      const proof = await provePassport(fixtureInputs());
      setResult(proof);
      setState("done");
    } catch (e) {
      setState(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <main className="p-8 font-mono text-sm">
      <button id="prove" className="rounded border px-3 py-2" onClick={run}>
        Prove fixture
      </button>
      <p id="state">{state}</p>
      {result && (
        <p id="result">
          proving_ms={result.provingMs} proof_bytes={(result.proof.length - 2) / 2} public_inputs=
          {result.publicInputs.length}
        </p>
      )}
    </main>
  );
}
