// Circuit tests with real Merkle trees: each payroll run has two employees (the prover at
// index 1), and the registry holds the three runs at indices 0..2.

use crate::lib::{
    commitment, merkle_root, node, payroll_leaf, PERIODS, pseudonym, REGISTRY_DEPTH, registry_leaf,
    RUN_DEPTH,
};
use crate::main;

struct Fixture {
    registry_root: Field,
    periods: [Field; PERIODS],
    threshold: u64,
    scope: Field,
    nonce: Field,
    pseudonym_out: Field,
    passport_secret: Field,
    employer_id: Field,
    gross: [u64; PERIODS],
    salts: [Field; PERIODS],
    run_roots: [Field; PERIODS],
    run_siblings: [[Field; RUN_DEPTH]; PERIODS],
    run_is_right: [[bool; RUN_DEPTH]; PERIODS],
    registry_siblings: [[Field; REGISTRY_DEPTH]; PERIODS],
    registry_is_right: [[bool; REGISTRY_DEPTH]; PERIODS],
}

/// zero[i] is the root of an empty subtree of height i (empty leaf = 0).
fn zero_hashes<let D: u32>() -> [Field; D] {
    let mut zero = [0; D];
    for i in 1..D {
        zero[i] = node(zero[i - 1], zero[i - 1]);
    }
    zero
}

fn fixture() -> Fixture {
    let passport_secret = 0x1234567890abcdef;
    let employer_id = 777;
    let scope = 999;
    // Month index = year * 12 + (month - 1): Jul, Aug, Sep 2026.
    let periods = [24318, 24319, 24320];
    let gross: [u64; PERIODS] = [2400, 2400, 2500];
    let salts = [11, 22, 33];

    let c = commitment(passport_secret);
    let run_zero: [Field; RUN_DEPTH] = zero_hashes();
    let reg_zero: [Field; REGISTRY_DEPTH] = zero_hashes();

    let mut run_roots = [0; PERIODS];
    let mut run_siblings = [[0; RUN_DEPTH]; PERIODS];
    let mut run_is_right = [[false; RUN_DEPTH]; PERIODS];
    let mut reg_leaves = [0; PERIODS];
    for k in 0..PERIODS {
        let coworker = payroll_leaf(42, employer_id, periods[k], 3000, 99);
        let mine = payroll_leaf(c, employer_id, periods[k], gross[k], salts[k]);
        let mut siblings = run_zero;
        siblings[0] = coworker;
        let mut is_right = [false; RUN_DEPTH];
        is_right[0] = true;
        run_siblings[k] = siblings;
        run_is_right[k] = is_right;
        run_roots[k] = merkle_root(mine, siblings, is_right);
        reg_leaves[k] = registry_leaf(employer_id, periods[k], run_roots[k]);
    }

    // Registry leaves at indices 0, 1, 2; index 3 is empty.
    let pair01 = node(reg_leaves[0], reg_leaves[1]);
    let pair23 = node(reg_leaves[2], 0);
    let mut registry_siblings = [reg_zero; PERIODS];
    let mut registry_is_right = [[false; REGISTRY_DEPTH]; PERIODS];
    registry_siblings[0][0] = reg_leaves[1];
    registry_siblings[0][1] = pair23;
    registry_siblings[1][0] = reg_leaves[0];
    registry_siblings[1][1] = pair23;
    registry_is_right[1][0] = true;
    registry_siblings[2][0] = 0;
    registry_siblings[2][1] = pair01;
    registry_is_right[2][1] = true;
    let registry_root = merkle_root(reg_leaves[0], registry_siblings[0], registry_is_right[0]);

    Fixture {
        registry_root,
        periods,
        threshold: 1500,
        scope,
        nonce: 1,
        pseudonym_out: pseudonym(passport_secret, scope),
        passport_secret,
        employer_id,
        gross,
        salts,
        run_roots,
        run_siblings,
        run_is_right,
        registry_siblings,
        registry_is_right,
    }
}

fn prove(f: Fixture) {
    main(
        f.registry_root,
        f.periods,
        f.threshold,
        f.scope,
        f.nonce,
        f.pseudonym_out,
        f.passport_secret,
        f.employer_id,
        f.gross,
        f.salts,
        f.run_roots,
        f.run_siblings,
        f.run_is_right,
        f.registry_siblings,
        f.registry_is_right,
    );
}

#[test]
fn test_valid_passport() {
    prove(fixture());
}

#[test]
fn test_threshold_equal_to_lowest_gross_passes() {
    let mut f = fixture();
    f.threshold = 2400;
    prove(f);
}

#[test(should_fail_with = "gross pay below threshold")]
fn test_threshold_above_gross_fails() {
    let mut f = fixture();
    f.threshold = 2450;
    prove(f);
}

#[test(should_fail_with = "pseudonym mismatch")]
fn test_pseudonym_for_other_scope_fails() {
    let mut f = fixture();
    f.pseudonym_out = pseudonym(f.passport_secret, f.scope + 1);
    prove(f);
}

#[test(should_fail_with = "periods must be consecutive")]
fn test_non_consecutive_periods_fail() {
    let mut f = fixture();
    f.periods[2] = f.periods[2] + 1;
    prove(f);
}

#[test(should_fail_with = "nonce must be non-zero")]
fn test_zero_nonce_fails() {
    let mut f = fixture();
    f.nonce = 0;
    prove(f);
}

#[test(should_fail_with = "run not in registry")]
fn test_unknown_registry_root_fails() {
    let mut f = fixture();
    f.registry_root = f.registry_root + 1;
    prove(f);
}

#[test(should_fail_with = "payroll leaf not in run")]
fn test_wrong_secret_fails() {
    let mut f = fixture();
    f.passport_secret = f.passport_secret + 1;
    f.pseudonym_out = pseudonym(f.passport_secret, f.scope);
    prove(f);
}

#[test(should_fail_with = "payroll leaf not in run")]
fn test_inflated_gross_fails() {
    let mut f = fixture();
    f.gross[0] = 9000;
    prove(f);
}

#[test]
fn test_pseudonyms_differ_across_scopes() {
    let secret = 5;
    assert(pseudonym(secret, 1) != pseudonym(secret, 2));
}
