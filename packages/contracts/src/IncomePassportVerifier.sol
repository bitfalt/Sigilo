// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IVerifier} from "./generated/HonkVerifier.sol";
import {SigiloRegistry} from "./SigiloRegistry.sol";

/// @title IncomePassportVerifier
/// @notice On-chain verification of income passport proofs (SPEC.md §8–§9). A proof says: "the
///         holder of `pseudonym` (for `scope`) was paid at least `threshold` by one verified
///         employer in each of three consecutive `periods`", against a payroll registry root
///         published in SigiloRegistry.
/// @dev Public input layout (circuit order, see packages/core/src/passport.ts):
///      [0] registryRoot, [1..3] periods (month indexes), [4] threshold (USD cents),
///      [5] scope, [6] nonce, [7] pseudonym.
contract IncomePassportVerifier {
    uint256 public constant PUBLIC_INPUT_COUNT = 8;

    struct Passport {
        bytes32 registryRoot;
        uint256 firstPeriod;
        uint64 threshold;
        uint256 scope;
        uint256 nonce;
        uint256 pseudonym;
    }

    IVerifier public immutable honkVerifier;
    SigiloRegistry public immutable registry;

    /// @notice Attested (scope, nonce) pairs; verification requests are single-use.
    mapping(bytes32 scopeNonce => bool used) public nonceUsed;

    event PassportVerified(
        uint256 indexed scope,
        uint256 indexed pseudonym,
        uint64 threshold,
        uint256 firstPeriod,
        uint256 nonce,
        bytes32 registryRoot
    );

    error ZeroAddress();
    error WrongPublicInputCount();
    error UnknownRegistryRoot();
    error InvalidProof();
    error NonceAlreadyUsed();

    constructor(IVerifier honkVerifier_, SigiloRegistry registry_) {
        if (address(honkVerifier_) == address(0) || address(registry_) == address(0)) {
            revert ZeroAddress();
        }
        honkVerifier = honkVerifier_;
        registry = registry_;
    }

    /// @notice Whether the proof is valid against a recently published registry root. Never
    ///         reverts on bad input; the generated verifier's reverts are mapped to `false`.
    function verify(bytes calldata proof, bytes32[] calldata publicInputs)
        public
        view
        returns (bool)
    {
        if (publicInputs.length != PUBLIC_INPUT_COUNT) return false;
        if (!registry.isKnownRoot(publicInputs[0])) return false;
        try honkVerifier.verify(proof, publicInputs) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }

    /// @notice Verify a proof, consume its (scope, nonce), and emit a public attestation.
    function attest(bytes calldata proof, bytes32[] calldata publicInputs)
        external
        returns (Passport memory passport)
    {
        if (publicInputs.length != PUBLIC_INPUT_COUNT) revert WrongPublicInputCount();
        passport = decode(publicInputs);
        // Cheap checks first: replays fail before the ~5M gas proof verification.
        bytes32 key = keccak256(abi.encode(passport.scope, passport.nonce));
        if (nonceUsed[key]) revert NonceAlreadyUsed();
        if (!registry.isKnownRoot(publicInputs[0])) revert UnknownRegistryRoot();
        if (!verify(proof, publicInputs)) revert InvalidProof();
        nonceUsed[key] = true;

        emit PassportVerified(
            passport.scope,
            passport.pseudonym,
            passport.threshold,
            passport.firstPeriod,
            passport.nonce,
            passport.registryRoot
        );
    }

    /// @notice Decode public inputs. Field ranges are enforced by the circuit for valid proofs.
    function decode(bytes32[] calldata publicInputs) public pure returns (Passport memory) {
        if (publicInputs.length != PUBLIC_INPUT_COUNT) revert WrongPublicInputCount();
        return Passport({
            registryRoot: publicInputs[0],
            firstPeriod: uint256(publicInputs[1]),
            threshold: uint64(uint256(publicInputs[4])),
            scope: uint256(publicInputs[5]),
            nonce: uint256(publicInputs[6]),
            pseudonym: uint256(publicInputs[7])
        });
    }
}
