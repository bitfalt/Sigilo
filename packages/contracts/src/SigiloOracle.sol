// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ReceiverTemplate} from "./cre/ReceiverTemplate.sol";

/// @title SigiloOracle
/// @notice On-chain output of Sigilo's Chainlink CRE "payday" workflow (packages/cre). The
///         workflow rebuilds the payroll registry tree from Sigilo's public leaves with the same
///         Poseidon2 tree the Income Passport circuit uses, compares it with the roots published
///         on SigiloRegistry, and reads every payroll-deducted advance from its AdvanceVault. The
///         DON signs one report per run and the Chainlink forwarder delivers it here, so anyone can
///         see that a registry root was independently checked, and which advances are behind on
///         their payroll installments, without trusting Sigilo's servers.
///
/// @dev Report layout (must match packages/cre/payday/report.ts):
///        abi.encode(uint64 observedAt, RootCheck[] roots, InstallmentStatus[] installments)
///      `observedAt` is the DON's consensus time in unix seconds. Reports from the future, older
///      than `MAX_REPORT_AGE`, or older than the last accepted one are rejected, so a delayed or
///      replayed report can't roll state back.
///
///      Trust: reports are accepted only from the configured forwarder (ReceiverTemplate). With
///      the MockKeystoneForwarder used by `cre workflow simulate --broadcast` that is a demo-grade
///      check (the mock does not verify DON signatures); with the production KeystoneForwarder,
///      also pin the workflow with `setExpectedAuthor` and `setExpectedWorkflowId`.
contract SigiloOracle is ReceiverTemplate {
    /// @notice A report must reach the chain within this many seconds of its observation.
    uint256 public constant MAX_REPORT_AGE = 1 hours;

    /// @notice A registry root and whether Sigilo's public leaves rebuild it.
    struct RootCheck {
        /// @notice A root published on SigiloRegistry.
        bytes32 root;
        /// @notice Leaves the root covers when consistent; leaves served when not.
        uint32 leafCount;
        /// @notice True when the first `leafCount` public leaves hash to `root`.
        bool consistent;
    }

    /// @notice The repayment status of one payroll-deducted advance.
    struct InstallmentStatus {
        address vault;
        uint256 advanceId;
        /// @notice Month index (year * 12 + month - 1, UTC) of the latest installment due.
        uint32 period;
        /// @notice True when the advance is open and has repaid less than its installments due.
        bool late;
    }

    /// @notice DON time of the last accepted report.
    uint64 public lastObservedAt;

    /// @notice DON time at which `root` was last confirmed against the public leaves (0 = never).
    mapping(bytes32 root => uint256 checkedAt) public rootCheckedAt;
    /// @notice Number of registry leaves `root` covers, as of its last confirmation.
    mapping(bytes32 root => uint256 leafCount) public rootLeafCount;
    /// @notice DON time at which `root` was last found NOT to match the public leaves (0 = never).
    mapping(bytes32 root => uint256 flaggedAt) public rootMismatchAt;
    /// @notice First period an advance was seen behind schedule; 0 when it is up to date.
    mapping(address vault => mapping(uint256 advanceId => uint256 period)) public lateSince;

    event RootChecked(bytes32 indexed root, uint256 leafCount, uint256 observedAt);
    event RootMismatch(bytes32 indexed root, uint256 leafCount, uint256 observedAt);
    event InstallmentLate(address indexed vault, uint256 indexed advanceId, uint256 period);
    event InstallmentCaughtUp(address indexed vault, uint256 indexed advanceId, uint256 lateSince);

    error ReportFromFuture(uint256 observedAt, uint256 blockTimestamp);
    error StaleReport(uint256 observedAt, uint256 blockTimestamp);
    error OutOfOrderReport(uint256 observedAt, uint256 lastObservedAt);
    error InvalidPeriod();
    error ZeroAddress();

    /// @param forwarder The Chainlink forwarder allowed to deliver reports: the Monad testnet
    ///        MockKeystoneForwarder for `cre workflow simulate --broadcast`, or the
    ///        KeystoneForwarder for a deployed workflow (see script/DeploySigiloOracle.s.sol).
    constructor(address forwarder) ReceiverTemplate(forwarder) {}

    /// @notice Whether an advance is currently flagged as behind on its installments.
    function isLate(address vault, uint256 advanceId) external view returns (bool) {
        return lateSince[vault][advanceId] != 0;
    }

    /// @notice Everything known about a registry root.
    /// @return checkedAt DON time of the last confirmation against the public leaves (0 = never).
    /// @return leafCount Leaves the root covers, as of that confirmation.
    /// @return mismatchAt DON time of the last failed check (0 = never).
    function rootStatus(bytes32 root)
        external
        view
        returns (uint256 checkedAt, uint256 leafCount, uint256 mismatchAt)
    {
        return (rootCheckedAt[root], rootLeafCount[root], rootMismatchAt[root]);
    }

    /// @inheritdoc ReceiverTemplate
    function _processReport(bytes calldata report) internal override {
        (uint64 observedAt, RootCheck[] memory roots, InstallmentStatus[] memory installments) =
            abi.decode(report, (uint64, RootCheck[], InstallmentStatus[]));

        // Freshness window on DON time; seconds of validator skew don't matter at this scale.
        // forge-lint: disable-next-line(block-timestamp)
        if (observedAt > block.timestamp) revert ReportFromFuture(observedAt, block.timestamp);
        // forge-lint: disable-next-line(block-timestamp)
        if (observedAt + MAX_REPORT_AGE < block.timestamp) {
            revert StaleReport(observedAt, block.timestamp);
        }
        if (observedAt < lastObservedAt) revert OutOfOrderReport(observedAt, lastObservedAt);
        lastObservedAt = observedAt;

        for (uint256 i; i < roots.length; ++i) {
            _recordRoot(roots[i], observedAt);
        }
        for (uint256 i; i < installments.length; ++i) {
            _recordInstallment(installments[i]);
        }
    }

    function _recordRoot(RootCheck memory check, uint256 observedAt) internal {
        if (check.consistent) {
            rootCheckedAt[check.root] = observedAt;
            rootLeafCount[check.root] = check.leafCount;
            emit RootChecked(check.root, check.leafCount, observedAt);
        } else {
            rootMismatchAt[check.root] = observedAt;
            emit RootMismatch(check.root, check.leafCount, observedAt);
        }
    }

    /// @dev Keeps the first period an advance was seen late until it catches up. A malformed item
    ///      rejects the whole report (the DON signed all of it or none).
    function _recordInstallment(InstallmentStatus memory status) internal {
        // forge-lint: disable-next-line(require-revert-in-loop)
        if (status.vault == address(0)) revert ZeroAddress();
        uint256 since = lateSince[status.vault][status.advanceId];
        if (status.late) {
            if (since != 0) return;
            // forge-lint: disable-next-line(require-revert-in-loop)
            if (status.period == 0) revert InvalidPeriod();
            lateSince[status.vault][status.advanceId] = status.period;
            emit InstallmentLate(status.vault, status.advanceId, status.period);
        } else if (since != 0) {
            delete lateSince[status.vault][status.advanceId];
            emit InstallmentCaughtUp(status.vault, status.advanceId, since);
        }
    }
}
