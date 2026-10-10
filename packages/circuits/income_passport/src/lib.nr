// Hashing and Merkle helpers shared by the income passport circuit (SPEC.md §7–§8).
// Every constant and hash layout here MUST match packages/core (pinned by cross-language
// test vectors). Changing any of them invalidates existing commitments and roots.

use poseidon::poseidon2::Poseidon2;

/// Consecutive payroll periods proven per passport.
pub global PERIODS: u32 = 3;
/// Depth of a single payroll run tree (up to 256 employees).
pub global RUN_DEPTH: u32 = 8;
/// Depth of the global registry tree of payroll runs.
pub global REGISTRY_DEPTH: u32 = 16;

// Domain separation tags: the first input of every hash.
pub global DOMAIN_COMMITMENT: Field = 1;
pub global DOMAIN_PSEUDONYM: Field = 2;
pub global DOMAIN_PAYROLL_LEAF: Field = 3;
pub global DOMAIN_REGISTRY_LEAF: Field = 4;
pub global DOMAIN_NODE: Field = 5;

/// Passport commitment registered with the employer: H(1, secret).
pub fn commitment(secret: Field) -> Field {
    Poseidon2::hash([DOMAIN_COMMITMENT, secret], 2)
}

/// Per-verifier pseudonym, unlinkable across scopes: H(2, secret, scope).
pub fn pseudonym(secret: Field, scope: Field) -> Field {
    Poseidon2::hash([DOMAIN_PSEUDONYM, secret, scope], 3)
}

/// Leaf of a payroll run tree: H(3, commitment, employer_id, period, gross, salt).
/// `period` is a month index (year * 12 + month - 1); `gross` is in USD cents.
pub fn payroll_leaf(
    commitment: Field,
    employer_id: Field,
    period: Field,
    gross: u64,
    salt: Field,
) -> Field {
    Poseidon2::hash(
        [DOMAIN_PAYROLL_LEAF, commitment, employer_id, period, gross as Field, salt],
        6,
    )
}

/// Leaf of the global registry tree: H(4, employer_id, period, run_root).
pub fn registry_leaf(employer_id: Field, period: Field, run_root: Field) -> Field {
    Poseidon2::hash([DOMAIN_REGISTRY_LEAF, employer_id, period, run_root], 4)
}

/// Internal Merkle node: H(5, left, right).
pub fn node(left: Field, right: Field) -> Field {
    Poseidon2::hash([DOMAIN_NODE, left, right], 3)
}

/// Root of a Merkle path. `is_right[i]` is true when the running node is the right child at
/// level i (i = 0 is the leaf level).
pub fn merkle_root<let D: u32>(leaf: Field, siblings: [Field; D], is_right: [bool; D]) -> Field {
    let mut current = leaf;
    for i in 0..D {
        let (left, right) = if is_right[i] {
            (siblings[i], current)
        } else {
            (current, siblings[i])
        };
        current = node(left, right);
    }
    current
}
