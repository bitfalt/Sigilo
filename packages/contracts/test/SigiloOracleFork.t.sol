// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {SigiloOracle} from "../src/SigiloOracle.sol";

/// @dev The subset of Chainlink's MockKeystoneForwarder used by `cre workflow simulate --broadcast`.
interface IMockKeystoneForwarder {
    function report(
        address receiver,
        bytes calldata rawReport,
        bytes calldata reportContext,
        bytes[] calldata signatures
    ) external;
}

/// @dev SigiloOracle behind the real MockKeystoneForwarder on a fork of Monad testnet: the exact
///      path a `--broadcast` simulation takes, and the gas it costs (Monad bills the gas limit,
///      so the workflow's per-report limit is calibrated here; see packages/cre/payday/report.ts).
///      Opt-in (needs network): `pnpm test:fork` in packages/contracts.
contract SigiloOracleForkTest is Test {
    // `cre workflow supported-chains`, monad-testnet, 2026-10-11.
    address internal constant MOCK_FORWARDER = 0xB9F79d863261869B234c481D1f9A7af84AeAd192;
    address internal constant VAULT = 0xdB38A7F37f45934A42f4ddD740d8F69414de7734;
    bytes32 internal constant ROOT_38 =
        0x07aaf04388f1bd397d46b5a817d48cc01efa82899493afd675a53fbc8efee0fa;

    // Mirrors packages/cre/payday/report.ts gasLimitFor().
    uint256 internal constant GAS_BASE = 200_000;
    uint256 internal constant GAS_PER_ROOT = 100_000;
    uint256 internal constant GAS_PER_INSTALLMENT = 45_000;

    bool internal forked;
    SigiloOracle internal oracle;

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        oracle = new SigiloOracle(MOCK_FORWARDER);
    }

    modifier onlyFork() {
        if (!forked) vm.skip(true);
        _;
    }

    /// @dev 109-byte forwarder metadata (version, execution id, timestamp, DON id, DON config
    ///      version, workflow id, workflow name, workflow owner, report id), then the payload.
    function _rawReport(bytes32 executionId, bytes memory payload)
        internal
        view
        returns (bytes memory)
    {
        return abi.encodePacked(
            uint8(1),
            executionId,
            uint32(block.timestamp),
            uint32(1),
            uint32(1),
            keccak256("payday"),
            bytes10("payday"),
            address(this),
            bytes2(0x0001),
            payload
        );
    }

    function _deliver(bytes32 executionId, uint256 installments, bool late)
        internal
        returns (uint256 gasUsed)
    {
        SigiloOracle.RootCheck[] memory roots = new SigiloOracle.RootCheck[](1);
        roots[0] = SigiloOracle.RootCheck(ROOT_38, 38, true);
        SigiloOracle.InstallmentStatus[] memory items =
            new SigiloOracle.InstallmentStatus[](installments);
        for (uint256 i; i < installments; ++i) {
            items[i] = SigiloOracle.InstallmentStatus(VAULT, i + 1, 24_321, late);
        }
        bytes memory raw =
            _rawReport(executionId, abi.encode(uint64(block.timestamp), roots, items));
        uint256 before = gasleft();
        IMockKeystoneForwarder(MOCK_FORWARDER).report(address(oracle), raw, "", new bytes[](0));
        gasUsed = before - gasleft();
    }

    function test_fork_mockForwarderDeliversTheReport() public onlyFork {
        uint256 used = _deliver(keccak256("exec-1"), 2, true);
        emit log_named_uint("forwarder.report gas, 1 root + 2 late", used);
        assertEq(oracle.rootCheckedAt(ROOT_38), block.timestamp);
        assertEq(oracle.rootLeafCount(ROOT_38), 38);
        assertEq(oracle.lateSince(VAULT, 1), 24_321);
        assertEq(oracle.lateSince(VAULT, 2), 24_321);
        assertLt(used + 21_000 + 16 * 1_500, GAS_BASE + GAS_PER_ROOT + 2 * GAS_PER_INSTALLMENT);
    }

    function test_fork_worstCaseFitsTheWorkflowGasEstimate() public onlyFork {
        uint256 used = _deliver(keccak256("exec-2"), 64, true);
        emit log_named_uint("forwarder.report gas, 1 root + 64 new late flags", used);
        assertEq(oracle.lateSince(VAULT, 64), 24_321);
        // Plus the transaction's intrinsic gas and calldata (~16 gas per byte, ~11 kB).
        assertLt(used + 21_000 + 16 * 11_000, GAS_BASE + GAS_PER_ROOT + 64 * GAS_PER_INSTALLMENT);
    }
}
