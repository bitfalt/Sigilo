import { describe, expect, test } from "vitest";

import { fieldToHex } from "./field";
import { commitment, node, payrollLeaf, poseidon2, pseudonym, registryLeaf } from "./hash";
import { merkleRoot, registryTree, runTree, zeroHashes } from "./merkle";
import { periodFromIndex, periodIndex } from "./period";
import { verifierScope } from "./scope";

// Cross-language vectors. The circuit's tests.nr (`test_cross_language_vectors`) asserts the
// same values for the same fixture, so a drift on either side fails a test suite.
const V = {
  commitment: "0x04401786d573dd40ebf203160561072e98b1e90851e55a0fa804d0f93954dc2d",
  pseudonym: "0x00d81107e1d8b8776be8b5fdf0b62ed989c74d3a477a80d575b3a0b75b820a79",
  payrollLeaf0: "0x013f6759cc8d948ed301e9b17b36fea3d0b399d18268c9d578c74196dc467eec",
  runRoots: [
    "0x1d42bcd77b8c96e8cc60654e8c8fd6edf8a5b9f64dcef9920c6c934ea98fe8a1",
    "0x0536d4038e2300bfc638652fcf2a9cf01ab4df5cc7b0f9e21ce1436a12f32f5b",
    "0x04504bbecdcbe180d7ce17246d72d37514a6c926797046179b164e59ea4d1f50",
  ],
  registryLeaf0: "0x2337ac414a1d29d144d439e8ff9b7fa18f55bb9b1c4160c63b6aaaedaaec24f4",
  registryRoot: "0x1071e5acd50fbcf685407efcde701f5eaa71f94d261d699e6d53a791bb2da967",
  emptyRun: "0x1210daf067cda09c37dc7fab28d05adf2989e161c3a5b55b92eb0beb0c820e72",
  emptyRegistry: "0x1a8e5ed1f1128e6ca54bffc1b94fa4a6cd092049d280d6f6577e2f4bea81346b",
};

// Same fixture as tests.nr: two employees per run (the prover at index 1), three runs in the
// registry at indexes 0..2.
const secret = 0x1234567890abcdefn;
const employerId = 777n;
const scope = 999n;
const periods = [24318n, 24319n, 24320n];
const gross = [2400n, 2400n, 2500n];
const salts = [11n, 22n, 33n];

function buildFixture() {
  const c = commitment(secret);
  const runs = periods.map((p, k) =>
    runTree([
      payrollLeaf(42n, employerId, p, 3000n, 99n),
      payrollLeaf(c, employerId, p, gross[k]!, salts[k]!),
    ]),
  );
  const regLeaves = runs.map((run, k) => registryLeaf(employerId, periods[k]!, run.root));
  return { c, runs, regLeaves, registry: registryTree(regLeaves) };
}

describe("Poseidon2", () => {
  test("matches Noir Poseidon2::hash([1, 2], 2)", () => {
    expect(fieldToHex(poseidon2([1n, 2n]))).toBe(
      "0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383",
    );
  });

  test("rejects inputs outside the field", () => {
    expect(() => poseidon2([-1n])).toThrow(RangeError);
    expect(() => payrollLeaf(1n, 1n, 1n, 1n << 64n, 1n)).toThrow(RangeError);
  });
});

describe("cross-language vectors (tests.nr fixture)", () => {
  const { c, runs, regLeaves, registry } = buildFixture();

  test("commitment, pseudonym and leaves", () => {
    expect(fieldToHex(c)).toBe(V.commitment);
    expect(fieldToHex(pseudonym(secret, scope))).toBe(V.pseudonym);
    expect(fieldToHex(payrollLeaf(c, employerId, periods[0]!, gross[0]!, salts[0]!))).toBe(
      V.payrollLeaf0,
    );
    expect(fieldToHex(regLeaves[0]!)).toBe(V.registryLeaf0);
  });

  test("run and registry roots", () => {
    expect(runs.map((r) => fieldToHex(r.root))).toEqual(V.runRoots);
    expect(fieldToHex(registry.root)).toBe(V.registryRoot);
  });

  test("empty tree roots", () => {
    expect(fieldToHex(runTree([]).root)).toBe(V.emptyRun);
    expect(fieldToHex(registryTree([]).root)).toBe(V.emptyRegistry);
  });
});

describe("Merkle paths", () => {
  const { runs, regLeaves, registry } = buildFixture();

  test("every registry path hashes back to the root", () => {
    regLeaves.forEach((leaf, i) => {
      const path = registry.path(i);
      expect(path.siblings).toHaveLength(16);
      expect(merkleRoot(leaf, path)).toBe(registry.root);
    });
  });

  test("path layout matches the circuit fixture", () => {
    const run = runs[0]!;
    const path = run.path(1);
    expect(path.isRight).toEqual([true, false, false, false, false, false, false, false]);
    expect(path.siblings[0]).toBe(run.leaves[0]);
    expect(path.siblings.slice(1)).toEqual(zeroHashes(8).slice(1, 8));

    const reg = registry.path(2);
    expect(reg.siblings[0]).toBe(0n);
    expect(reg.siblings[1]).toBe(node(regLeaves[0]!, regLeaves[1]!));
    expect(reg.isRight.slice(0, 2)).toEqual([false, true]);
  });

  test("a wrong leaf does not reach the root", () => {
    expect(merkleRoot(regLeaves[0]! + 1n, registry.path(0))).not.toBe(registry.root);
  });

  test("rejects overfull trees and bad indexes", () => {
    expect(() => runTree(Array.from({ length: 257 }, () => 1n))).toThrow(RangeError);
    expect(() => registry.path(3)).toThrow(RangeError);
  });

  test("full run tree (256 leaves)", () => {
    const leaves = Array.from({ length: 256 }, (_, i) => BigInt(i + 1));
    const tree = runTree(leaves);
    expect(merkleRoot(leaves[255]!, tree.path(255))).toBe(tree.root);
  });
});

describe("periods", () => {
  test("month index encoding", () => {
    expect(periodIndex({ year: 2026, month: 7 })).toBe(24318);
    expect(periodIndex({ year: 2026, month: 12 }) + 1).toBe(periodIndex({ year: 2027, month: 1 }));
    expect(periodFromIndex(24321)).toEqual({ year: 2026, month: 10 });
    expect(() => periodIndex({ year: 2026, month: 13 })).toThrow(RangeError);
  });
});

describe("verifier scope", () => {
  test("matches keccak256(abi.encode(address, uint256)) mod r (cross-checked with cast)", () => {
    expect(fieldToHex(verifierScope("0x00000000000000000000000000000000DeaDBeef", 10143))).toBe(
      "0x0686920795a00769f64524eb206a84efad01115dffa2344faf504f1bea0dd6e6",
    );
  });
});
