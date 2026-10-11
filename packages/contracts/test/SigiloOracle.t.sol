// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {IERC165} from "../src/cre/IERC165.sol";
import {IReceiver} from "../src/cre/IReceiver.sol";
import {Ownable} from "../src/cre/Ownable.sol";
import {ReceiverTemplate} from "../src/cre/ReceiverTemplate.sol";
import {SigiloOracle} from "../src/SigiloOracle.sol";

contract SigiloOracleTest is Test {
    SigiloOracle internal oracle;
    address internal forwarder = makeAddr("forwarder");
    address internal stranger = makeAddr("stranger");
    address internal vault = 0xdB38A7F37f45934A42f4ddD740d8F69414de7734;

    bytes32 internal constant ROOT_38 =
        0x07aaf04388f1bd397d46b5a817d48cc01efa82899493afd675a53fbc8efee0fa;
    bytes32 internal constant ROOT_37 =
        0x2b6e4595584516d42f4a87e65f7095885620f127ca7ed439f1809ccc62c5cdb7;
    uint64 internal constant T0 = 1_791_748_283;

    // Encoded by packages/cre/payday/report.ts (workflow.test.ts pins the same bytes).
    bytes internal constant REPORT_VECTOR =
        hex"000000000000000000000000000000000000000000000000000000006acbe8bb00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000140000000000000000000000000000000000000000000000000000000000000000207aaf04388f1bd397d46b5a817d48cc01efa82899493afd675a53fbc8efee0fa000000000000000000000000000000000000000000000000000000000000002600000000000000000000000000000000000000000000000000000000000000012b6e4595584516d42f4a87e65f7095885620f127ca7ed439f1809ccc62c5cdb7000000000000000000000000000000000000000000000000000000000000002600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000db38a7f37f45934a42f4ddd740d8f69414de773400000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000005f010000000000000000000000000000000000000000000000000000000000000001000000000000000000000000db38a7f37f45934a42f4ddd740d8f69414de773400000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000005f000000000000000000000000000000000000000000000000000000000000000000";

    function setUp() public {
        oracle = new SigiloOracle(forwarder);
        vm.warp(T0 + 30);
    }

    // ------------------------------------------------------------ helpers

    function _noRoots() internal pure returns (SigiloOracle.RootCheck[] memory) {
        return new SigiloOracle.RootCheck[](0);
    }

    function _noInstallments() internal pure returns (SigiloOracle.InstallmentStatus[] memory) {
        return new SigiloOracle.InstallmentStatus[](0);
    }

    function _root(bytes32 root, uint32 leafCount, bool consistent)
        internal
        pure
        returns (SigiloOracle.RootCheck[] memory roots)
    {
        roots = new SigiloOracle.RootCheck[](1);
        roots[0] = SigiloOracle.RootCheck(root, leafCount, consistent);
    }

    function _installment(uint256 advanceId, uint32 period, bool late)
        internal
        view
        returns (SigiloOracle.InstallmentStatus[] memory items)
    {
        items = new SigiloOracle.InstallmentStatus[](1);
        items[0] = SigiloOracle.InstallmentStatus(vault, advanceId, period, late);
    }

    function _report(
        uint64 observedAt,
        SigiloOracle.RootCheck[] memory roots,
        SigiloOracle.InstallmentStatus[] memory items
    ) internal pure returns (bytes memory) {
        return abi.encode(observedAt, roots, items);
    }

    /// @dev 64 bytes, as the production KeystoneForwarder passes it: workflowId, name, owner,
    ///      reportId.
    function _metadata(bytes32 workflowId, bytes10 name, address owner)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(workflowId, name, owner, bytes2(0x0001));
    }

    function _deliver(bytes memory report) internal {
        vm.prank(forwarder);
        oracle.onReport("", report);
    }

    // ------------------------------------------------------------ receiver plumbing

    function test_constructor_setsForwarderAndOwner() public view {
        assertEq(oracle.getForwarderAddress(), forwarder);
        assertEq(oracle.owner(), address(this));
    }

    function test_constructor_rejectsZeroForwarder() public {
        vm.expectRevert(ReceiverTemplate.InvalidForwarderAddress.selector);
        new SigiloOracle(address(0));
    }

    function test_supportsInterface() public view {
        assertTrue(oracle.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(oracle.supportsInterface(type(IERC165).interfaceId));
        assertFalse(oracle.supportsInterface(0xffffffff));
    }

    function test_onReport_onlyForwarder() public {
        bytes memory report = _report(T0, _root(ROOT_38, 38, true), _noInstallments());
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(ReceiverTemplate.InvalidSender.selector, stranger, forwarder)
        );
        oracle.onReport("", report);
    }

    function test_setters_onlyOwner() public {
        vm.startPrank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        oracle.setForwarderAddress(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        oracle.setExpectedAuthor(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        oracle.setExpectedWorkflowId(bytes32(uint256(1)));
        vm.stopPrank();
    }

    function test_setForwarderAddress_movesTrust() public {
        address keystone = makeAddr("keystone");
        oracle.setForwarderAddress(keystone);
        bytes memory report = _report(T0, _root(ROOT_38, 38, true), _noInstallments());
        vm.prank(forwarder);
        vm.expectRevert(
            abi.encodeWithSelector(ReceiverTemplate.InvalidSender.selector, forwarder, keystone)
        );
        oracle.onReport("", report);
        vm.prank(keystone);
        oracle.onReport("", report);
        assertEq(oracle.rootCheckedAt(ROOT_38), T0);
    }

    function test_workflowIdentity_checkedFromMetadata() public {
        address author = makeAddr("workflowOwner");
        bytes32 workflowId = keccak256("payday");
        oracle.setExpectedAuthor(author);
        oracle.setExpectedWorkflowId(workflowId);
        bytes memory report = _report(T0, _root(ROOT_38, 38, true), _noInstallments());

        vm.prank(forwarder);
        vm.expectRevert(
            abi.encodeWithSelector(ReceiverTemplate.InvalidAuthor.selector, stranger, author)
        );
        oracle.onReport(_metadata(workflowId, bytes10("payday"), stranger), report);

        bytes32 otherId = keccak256("other");
        vm.prank(forwarder);
        vm.expectRevert(
            abi.encodeWithSelector(ReceiverTemplate.InvalidWorkflowId.selector, otherId, workflowId)
        );
        oracle.onReport(_metadata(otherId, bytes10("payday"), author), report);

        vm.prank(forwarder);
        oracle.onReport(_metadata(workflowId, bytes10("payday"), author), report);
        assertEq(oracle.rootCheckedAt(ROOT_38), T0);
    }

    // ------------------------------------------------------------ roots

    function test_consistentRoot_isRecorded() public {
        vm.expectEmit(true, false, false, true, address(oracle));
        emit SigiloOracle.RootChecked(ROOT_38, 38, T0);
        _deliver(_report(T0, _root(ROOT_38, 38, true), _noInstallments()));

        (uint256 checkedAt, uint256 leafCount, uint256 mismatchAt) = oracle.rootStatus(ROOT_38);
        assertEq(checkedAt, T0);
        assertEq(leafCount, 38);
        assertEq(mismatchAt, 0);
        assertEq(oracle.lastObservedAt(), T0);
    }

    function test_mismatchedRoot_isFlaggedNotConfirmed() public {
        vm.expectEmit(true, false, false, true, address(oracle));
        emit SigiloOracle.RootMismatch(ROOT_37, 30, T0);
        _deliver(_report(T0, _root(ROOT_37, 30, false), _noInstallments()));

        (uint256 checkedAt,, uint256 mismatchAt) = oracle.rootStatus(ROOT_37);
        assertEq(checkedAt, 0);
        assertEq(mismatchAt, T0);
    }

    // ------------------------------------------------------------ installments

    function test_lateInstallment_keepsFirstPeriodUntilCaughtUp() public {
        vm.expectEmit(true, true, false, true, address(oracle));
        emit SigiloOracle.InstallmentLate(vault, 2, 24_321);
        _deliver(_report(T0, _noRoots(), _installment(2, 24_321, true)));
        assertEq(oracle.lateSince(vault, 2), 24_321);
        assertTrue(oracle.isLate(vault, 2));

        // Still late a month later: the first period stays, no new event.
        vm.recordLogs();
        _deliver(_report(T0 + 1, _noRoots(), _installment(2, 24_322, true)));
        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(oracle.lateSince(vault, 2), 24_321);

        vm.expectEmit(true, true, false, true, address(oracle));
        emit SigiloOracle.InstallmentCaughtUp(vault, 2, 24_321);
        _deliver(_report(T0 + 2, _noRoots(), _installment(2, 24_322, false)));
        assertEq(oracle.lateSince(vault, 2), 0);
        assertFalse(oracle.isLate(vault, 2));
    }

    function test_onScheduleInstallment_isANoOp() public {
        vm.recordLogs();
        _deliver(_report(T0, _noRoots(), _installment(1, 24_321, false)));
        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(oracle.lateSince(vault, 1), 0);
    }

    function test_installment_rejectsZeroPeriodAndZeroVault() public {
        vm.prank(forwarder);
        vm.expectRevert(SigiloOracle.InvalidPeriod.selector);
        oracle.onReport("", _report(T0, _noRoots(), _installment(2, 0, true)));

        SigiloOracle.InstallmentStatus[] memory items = _installment(2, 24_321, true);
        items[0].vault = address(0);
        vm.prank(forwarder);
        vm.expectRevert(SigiloOracle.ZeroAddress.selector);
        oracle.onReport("", _report(T0, _noRoots(), items));
    }

    // ------------------------------------------------------------ timestamps

    function test_rejectsReportFromTheFuture() public {
        uint64 future = uint64(block.timestamp + 1);
        vm.prank(forwarder);
        vm.expectRevert(
            abi.encodeWithSelector(SigiloOracle.ReportFromFuture.selector, future, block.timestamp)
        );
        oracle.onReport("", _report(future, _root(ROOT_38, 38, true), _noInstallments()));
    }

    function test_rejectsStaleReport() public {
        vm.warp(T0 + oracle.MAX_REPORT_AGE() + 1);
        vm.prank(forwarder);
        vm.expectRevert(
            abi.encodeWithSelector(SigiloOracle.StaleReport.selector, T0, block.timestamp)
        );
        oracle.onReport("", _report(T0, _root(ROOT_38, 38, true), _noInstallments()));

        // Exactly MAX_REPORT_AGE old is still accepted.
        vm.warp(T0 + oracle.MAX_REPORT_AGE());
        _deliver(_report(T0, _root(ROOT_38, 38, true), _noInstallments()));
    }

    function test_rejectsOlderThanLastAccepted_acceptsSameSecond() public {
        _deliver(_report(T0 + 10, _noRoots(), _installment(2, 24_321, true)));
        _deliver(_report(T0 + 10, _root(ROOT_38, 38, true), _noInstallments()));

        // A delayed "caught up" can't roll the flag back.
        vm.prank(forwarder);
        vm.expectRevert(
            abi.encodeWithSelector(SigiloOracle.OutOfOrderReport.selector, T0 + 9, T0 + 10)
        );
        oracle.onReport("", _report(T0 + 9, _noRoots(), _installment(2, 24_321, false)));
        assertTrue(oracle.isLate(vault, 2));
    }

    // ------------------------------------------------------------ cross-language vector

    function test_reportVector_fromTheWorkflow() public {
        (
            uint64 observedAt,
            SigiloOracle.RootCheck[] memory roots,
            SigiloOracle.InstallmentStatus[] memory items
        ) = abi.decode(
            REPORT_VECTOR, (uint64, SigiloOracle.RootCheck[], SigiloOracle.InstallmentStatus[])
        );
        assertEq(observedAt, T0);
        assertEq(roots.length, 2);
        assertEq(roots[0].root, ROOT_38);
        assertEq(roots[0].leafCount, 38);
        assertTrue(roots[0].consistent);
        assertEq(roots[1].root, ROOT_37);
        assertFalse(roots[1].consistent);
        assertEq(items.length, 2);
        assertEq(items[0].vault, vault);
        assertEq(items[0].advanceId, 2);
        assertEq(items[0].period, 24_321);
        assertTrue(items[0].late);
        assertEq(items[1].advanceId, 1);
        assertFalse(items[1].late);

        _deliver(REPORT_VECTOR);
        assertEq(oracle.rootCheckedAt(ROOT_38), T0);
        assertEq(oracle.rootLeafCount(ROOT_38), 38);
        assertEq(oracle.rootMismatchAt(ROOT_37), T0);
        assertEq(oracle.lateSince(vault, 2), 24_321);
        assertEq(oracle.lateSince(vault, 1), 0);
    }

    // ------------------------------------------------------------ gas (Monad bills the limit)

    /// @dev The workflow sizes each report's gas limit as GAS_BASE + GAS_PER_ROOT * roots +
    ///      GAS_PER_INSTALLMENT * installments (packages/cre/payday/report.ts). The receiver's
    ///      share must fit inside the per-item budget, worst case: 64 advances all newly late.
    ///      SigiloOracleFork.t.sol checks the whole path through the real MockKeystoneForwarder.
    function test_gas_fullReportFitsTheWorkflowGasLimit() public {
        SigiloOracle.InstallmentStatus[] memory items = new SigiloOracle.InstallmentStatus[](64);
        for (uint256 i; i < items.length; ++i) {
            items[i] = SigiloOracle.InstallmentStatus(vault, i + 1, 24_321, true);
        }
        bytes memory report = _report(T0, _root(ROOT_38, 38, true), items);
        vm.prank(forwarder);
        uint256 before = gasleft();
        oracle.onReport("", report);
        uint256 used = before - gasleft();
        emit log_named_uint("onReport gas, 1 root + 64 new late flags", used);
        assertLt(used, 100_000 + 64 * 45_000, "onReport exceeds the workflow's per-item gas budget");
    }

    // ------------------------------------------------------------ fuzz

    function testFuzz_timestampWindow(uint64 observedAt) public {
        bytes memory report = _report(observedAt, _root(ROOT_38, 38, true), _noInstallments());
        bool ok = observedAt <= block.timestamp
            && uint256(observedAt) + oracle.MAX_REPORT_AGE() >= block.timestamp;
        vm.prank(forwarder);
        if (!ok) vm.expectRevert();
        oracle.onReport("", report);
        assertEq(oracle.rootCheckedAt(ROOT_38), ok ? observedAt : 0);
    }
}
