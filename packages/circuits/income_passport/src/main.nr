// income_passport: "I know a passport secret whose commitment appears in the payroll runs of
// the same verified employer for PERIODS consecutive periods, with gross pay >= threshold in
// each, and `pseudonym` is my identity for `scope`." (SPEC.md §8)
//
// The registry tree only contains runs of verified employers, so membership under a known
// `registry_root` (checked on-chain by SigiloRegistry.isKnownRoot) implies a verified employer
// without revealing which one.

mod lib;
mod tests;

use lib::{
    commitment, merkle_root, payroll_leaf, PERIODS, pseudonym, REGISTRY_DEPTH, registry_leaf,
    RUN_DEPTH,
};

fn main(
    // Public inputs
    registry_root: pub Field,
    periods: pub [Field; PERIODS],
    threshold: pub u64,
    scope: pub Field,
    nonce: pub Field,
    pseudonym_out: pub Field,
    // Private inputs
    passport_secret: Field,
    employer_id: Field,
    gross: [u64; PERIODS],
    salts: [Field; PERIODS],
    run_roots: [Field; PERIODS],
    run_siblings: [[Field; RUN_DEPTH]; PERIODS],
    run_is_right: [[bool; RUN_DEPTH]; PERIODS],
    registry_siblings: [[Field; REGISTRY_DEPTH]; PERIODS],
    registry_is_right: [[bool; REGISTRY_DEPTH]; PERIODS],
) {
    // Requests are single-use; a zero nonce means the verifier did not bind one.
    assert(nonce != 0, "nonce must be non-zero");

    let c = commitment(passport_secret);

    for k in 0..PERIODS {
        assert_eq(periods[k], periods[0] + k as Field, "periods must be consecutive");
        assert(gross[k] >= threshold, "gross pay below threshold");

        let leaf = payroll_leaf(c, employer_id, periods[k], gross[k], salts[k]);
        assert_eq(
            merkle_root(leaf, run_siblings[k], run_is_right[k]),
            run_roots[k],
            "payroll leaf not in run",
        );

        let reg_leaf = registry_leaf(employer_id, periods[k], run_roots[k]);
        assert_eq(
            merkle_root(reg_leaf, registry_siblings[k], registry_is_right[k]),
            registry_root,
            "run not in registry",
        );
    }

    assert_eq(pseudonym(passport_secret, scope), pseudonym_out, "pseudonym mismatch");
}

#[test]
fn test_poseidon2_vector() {
    // Cross-language vector: packages/core must reproduce this value.
    let h: Field = poseidon::poseidon2::Poseidon2::hash([1, 2], 2);
    assert_eq(h, 0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383);
}
