// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SigiloRegistry
/// @notice Operator-managed registry of verified employers and of the global payroll registry
///         root (SPEC.md §7 and §9). Every payroll run of a verified employer is committed as a
///         leaf of an off-chain Poseidon2 tree; the operator publishes the resulting root here so
///         income passport proofs can be checked against a recent, known root.
/// @dev Hackathon trust model: the operator is trusted to publish correct roots. Roots are BN254
///      field elements because they are public inputs of the Noir circuit.
contract SigiloRegistry {
    /// @notice BN254 scalar field modulus.
    uint256 internal constant BN254_R =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    /// @notice Number of recent roots accepted by `isKnownRoot`.
    uint256 public constant ROOT_HISTORY_SIZE = 64;

    address public operator;
    mapping(bytes32 employerId => bool verified) public isVerifiedEmployer;

    bytes32[ROOT_HISTORY_SIZE] public rootHistory;
    /// @notice Total number of roots ever published.
    uint256 public rootCount;
    bytes32 public latestRoot;

    event OperatorTransferred(address indexed previousOperator, address indexed newOperator);
    event EmployerVerificationSet(bytes32 indexed employerId, bool verified);
    event RootPublished(bytes32 indexed root, uint256 indexed index);

    error NotOperator();
    error ZeroAddress();
    error InvalidRoot();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(address initialOperator) {
        if (initialOperator == address(0)) revert ZeroAddress();
        operator = initialOperator;
        emit OperatorTransferred(address(0), initialOperator);
    }

    function transferOperator(address newOperator) external onlyOperator {
        if (newOperator == address(0)) revert ZeroAddress();
        emit OperatorTransferred(operator, newOperator);
        operator = newOperator;
    }

    function setEmployerVerified(bytes32 employerId, bool verified) external onlyOperator {
        isVerifiedEmployer[employerId] = verified;
        emit EmployerVerificationSet(employerId, verified);
    }

    /// @notice Publish a new registry root. Must be a non-zero BN254 field element.
    function publishRoot(bytes32 root) external onlyOperator {
        if (root == bytes32(0) || uint256(root) >= BN254_R) revert InvalidRoot();
        uint256 index = rootCount;
        rootHistory[index % ROOT_HISTORY_SIZE] = root;
        rootCount = index + 1;
        latestRoot = root;
        emit RootPublished(root, index);
    }

    /// @notice Whether `root` is one of the last `ROOT_HISTORY_SIZE` published roots.
    function isKnownRoot(bytes32 root) public view returns (bool) {
        if (root == bytes32(0)) return false;
        uint256 n = rootCount < ROOT_HISTORY_SIZE ? rootCount : ROOT_HISTORY_SIZE;
        for (uint256 i; i < n; ++i) {
            if (rootHistory[i] == root) return true;
        }
        return false;
    }
}
