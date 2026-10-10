// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {AdvanceVault, IERC20, IPassportVerifier} from "../src/AdvanceVault.sol";
import {MockPassportVerifier, ReentrantToken} from "./mocks/AdvanceMocks.sol";
import {MockToken} from "./mocks/AgoraMocks.sol";

/// @dev Fast paths with a mock proof verifier. AdvanceVaultProof.t.sol runs a real proof.
contract AdvanceVaultTest is Test {
    uint256 internal constant BN254_R =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    /// 2026-10-10 12:00:00 UTC.
    uint256 internal constant NOW = 1_791_633_600;
    /// September 2026: the newest proven month in these tests.
    uint256 internal constant SEP_2026 = 2026 * 12 + 8;
    uint64 internal constant THRESHOLD = 150_000; // $1,500.00 a month
    uint256 internal constant MAX = 450e6; // 30% of $1,500, in AUSD base units
    uint256 internal constant PSEUDONYM = 0x5eed;
    bytes internal constant PROOF = hex"c0ffee";

    MockToken internal ausd;
    MockPassportVerifier internal verifier;
    AdvanceVault internal vault;

    address internal lender = makeAddr("lender");
    address internal relayer = makeAddr("relayer");
    address internal maria = makeAddr("maria"); // her fresh one-time account
    address internal thief = makeAddr("thief");
    address internal treasury = makeAddr("treasury");

    struct Request {
        bytes32[] inputs;
        uint256 amount;
        address recipient;
        uint256 deadline;
        bytes32 salt;
    }

    function setUp() public {
        vm.warp(NOW);
        ausd = new MockToken("AUSD", "AUSD", 6);
        verifier = new MockPassportVerifier();
        vault = new AdvanceVault(
            IERC20(address(ausd)), IPassportVerifier(address(verifier)), lender, 3000, 200
        );
        ausd.mint(address(vault), 2_000e6); // the lender's deposit
        ausd.mint(treasury, 10_000e6);
        vm.prank(treasury);
        ausd.approve(address(vault), type(uint256).max);
    }

    // ------------------------------------------------------------ helpers

    function _inputs(uint256 pseudonym, uint256 nonce, uint256 lastPeriod)
        internal
        view
        returns (bytes32[] memory p)
    {
        p = new bytes32[](8);
        p[0] = bytes32(uint256(0x1234)); // registry root (the mock ignores it)
        p[1] = bytes32(lastPeriod - 2);
        p[2] = bytes32(lastPeriod - 1);
        p[3] = bytes32(lastPeriod);
        p[4] = bytes32(uint256(THRESHOLD));
        p[5] = bytes32(vault.scope());
        p[6] = bytes32(nonce);
        p[7] = bytes32(pseudonym);
    }

    /// A well-formed request bound to (recipient, amount, deadline, salt).
    function _req(uint256 pseudonym, address recipient, uint256 amount, bytes32 salt)
        internal
        view
        returns (Request memory r)
    {
        r.amount = amount;
        r.recipient = recipient;
        r.deadline = block.timestamp + 10 minutes;
        r.salt = salt;
        r.inputs = _inputs(pseudonym, vault.nonceFor(recipient, amount, r.deadline, salt), SEP_2026);
    }

    function _send(Request memory r) internal returns (uint256) {
        vm.prank(relayer);
        return vault.requestAdvance(PROOF, r.inputs, r.amount, r.recipient, r.deadline, r.salt);
    }

    function _issue() internal returns (uint256) {
        return _send(_req(PSEUDONYM, maria, MAX, bytes32("salt-1")));
    }

    function _repay(uint256 id, uint256 amount) internal returns (uint256) {
        vm.prank(treasury);
        return vault.repay(id, amount);
    }

    // ------------------------------------------------------------ vectors and views

    function test_constructor_setsTermsAndScope() public view {
        assertEq(address(vault.ausd()), address(ausd));
        assertEq(address(vault.verifier()), address(verifier));
        assertEq(vault.lender(), lender);
        assertEq(vault.maxRatioBps(), 3000);
        assertEq(vault.feeBps(), 200);
        assertEq(
            vault.scope(), uint256(keccak256(abi.encode(address(vault), block.chainid))) % BN254_R
        );
    }

    function test_constructor_rejectsBadArguments() public {
        IERC20 t = IERC20(address(ausd));
        IPassportVerifier v = IPassportVerifier(address(verifier));
        vm.expectRevert(AdvanceVault.ZeroAddress.selector);
        new AdvanceVault(IERC20(address(0)), v, lender, 3000, 200);
        vm.expectRevert(AdvanceVault.ZeroAddress.selector);
        new AdvanceVault(t, IPassportVerifier(address(0)), lender, 3000, 200);
        vm.expectRevert(AdvanceVault.ZeroAddress.selector);
        new AdvanceVault(t, v, address(0), 3000, 200);
        vm.expectRevert(AdvanceVault.InvalidTerms.selector);
        new AdvanceVault(t, v, lender, 0, 200);
        vm.expectRevert(AdvanceVault.InvalidTerms.selector);
        new AdvanceVault(t, v, lender, 10_001, 200);
        vm.expectRevert(AdvanceVault.InvalidTerms.selector);
        new AdvanceVault(t, v, lender, 3000, 10_001);
    }

    function test_nonceFor_matchesCoreVector() public view {
        // Same vector as packages/core/src/advance.test.ts and the advance proof fixture.
        assertEq(
            vault.nonceFor(
                address(0xCAFE),
                450_000_000,
                1_800_000_000,
                0x5a17000000000000000000000000000000000000000000000000000000adface
            ),
            0x0b9c01e4d9d6f3f84ba7495378aa0c6113528992baf012683f57ac9c5bd98a98
        );
    }

    function test_terms_capAndFee() public view {
        assertEq(vault.maxAdvance(THRESHOLD), MAX);
        assertEq(vault.maxAdvance(0), 0);
        assertEq(vault.maxAdvance(type(uint64).max), uint256(type(uint64).max) * 3000);
        assertEq(vault.advanceOwed(MAX), 459e6); // +2%
        // The fee rounds up.
        assertEq(vault.advanceOwed(1), 2);
        assertEq(vault.advanceOwed(49), 50);
        assertEq(vault.advanceOwed(50), 51);
        assertEq(vault.advanceOwed(51), 53);
    }

    function test_periodOf_vectors() public view {
        assertEq(vault.periodOf(0), 1970 * 12); // 1970-01-01
        assertEq(vault.periodOf(NOW), 2026 * 12 + 9); // 2026-10-10
        assertEq(vault.periodOf(1_709_251_199), 2024 * 12 + 1); // 2024-02-29 23:59:59
        assertEq(vault.periodOf(1_709_251_200), 2024 * 12 + 2); // 2024-03-01
        assertEq(vault.periodOf(1_798_761_599), 2026 * 12 + 11); // 2026-12-31 23:59:59
        assertEq(vault.periodOf(1_798_761_600), 2027 * 12); // 2027-01-01
        assertEq(vault.periodOf(4_107_542_400), 2100 * 12 + 2); // 2100-03-01 (not a leap year)
        assertEq(vault.periodOf(4_107_542_399), 2100 * 12 + 1); // 2100-02-28 23:59:59
    }

    // ------------------------------------------------------------ requestAdvance

    function test_request_paysRecipientAndRecords() public {
        Request memory r = _req(PSEUDONYM, maria, MAX, bytes32("salt-1"));
        uint256 nonce = uint256(r.inputs[6]);

        vm.expectEmit(true, true, true, true, address(vault));
        emit AdvanceVault.AdvanceIssued(1, PSEUDONYM, maria, MAX, 459e6);
        uint256 id = _send(r);

        assertEq(id, 1);
        assertEq(vault.advanceCount(), 1);
        assertEq(ausd.balanceOf(maria), MAX);
        assertEq(ausd.balanceOf(address(vault)), 2_000e6 - MAX);
        assertEq(vault.activeAdvanceOf(PSEUDONYM), 1);
        assertTrue(vault.nonceUsed(nonce));
        assertEq(vault.remainingOf(1), 459e6);

        AdvanceVault.Advance memory a = vault.advances(1);
        assertEq(a.pseudonym, PSEUDONYM);
        assertEq(a.recipient, maria);
        assertEq(a.principal, MAX);
        assertEq(a.owed, 459e6);
        assertEq(a.repaid, 0);
        assertEq(a.issuedAt, NOW);
        assertTrue(a.active);
    }

    function test_request_acceptsLessThanTheCap() public {
        _send(_req(PSEUDONYM, maria, 100e6, bytes32("small")));
        assertEq(ausd.balanceOf(maria), 100e6);
        assertEq(vault.remainingOf(1), 102e6);
    }

    function test_request_revertsOnWrongScope() public {
        Request memory r = _req(PSEUDONYM, maria, MAX, bytes32("salt-1"));
        r.inputs[5] = bytes32(vault.scope() + 1);
        vm.expectRevert(AdvanceVault.WrongScope.selector);
        _send(r);
    }

    function test_request_frontRunCannotRedirect() public {
        Request memory r = _req(PSEUDONYM, maria, MAX, bytes32("salt-1"));

        // A mempool observer copies the proof and public inputs but names herself...
        vm.expectRevert(AdvanceVault.NonceMismatch.selector);
        vm.prank(thief);
        vault.requestAdvance(PROOF, r.inputs, r.amount, thief, r.deadline, r.salt);

        // ...or changes the amount, the deadline, or the salt.
        vm.expectRevert(AdvanceVault.NonceMismatch.selector);
        vault.requestAdvance(PROOF, r.inputs, MAX - 1, maria, r.deadline, r.salt);
        vm.expectRevert(AdvanceVault.NonceMismatch.selector);
        vault.requestAdvance(PROOF, r.inputs, MAX, maria, r.deadline + 1, r.salt);
        vm.expectRevert(AdvanceVault.NonceMismatch.selector);
        vault.requestAdvance(PROOF, r.inputs, MAX, maria, r.deadline, bytes32("other"));

        // The honest request still goes through.
        _send(r);
        assertEq(ausd.balanceOf(maria), MAX);
        assertEq(ausd.balanceOf(thief), 0);
    }

    function test_request_revertsOnZeroNonce() public {
        Request memory r = _req(PSEUDONYM, maria, MAX, bytes32("salt-1"));
        r.inputs[6] = bytes32(0);
        vm.expectRevert(AdvanceVault.NonceMismatch.selector);
        _send(r);
    }

    function test_request_revertsWhenExpired() public {
        Request memory r = _req(PSEUDONYM, maria, MAX, bytes32("salt-1"));
        vm.warp(r.deadline); // still valid at the deadline itself
        _send(r);

        r = _req(PSEUDONYM + 1, maria, MAX, bytes32("salt-2"));
        vm.warp(r.deadline + 1);
        vm.expectRevert(AdvanceVault.Expired.selector);
        _send(r);
    }

    function test_request_revertsOnReplayEvenAfterClose() public {
        Request memory r = _req(PSEUDONYM, maria, MAX, bytes32("salt-1"));
        uint256 id = _send(r);

        vm.expectRevert(AdvanceVault.NonceAlreadyUsed.selector);
        _send(r);

        _repay(id, type(uint256).max);
        assertEq(vault.activeAdvanceOf(PSEUDONYM), 0);
        vm.expectRevert(AdvanceVault.NonceAlreadyUsed.selector);
        _send(r);
    }

    function test_request_revertsAboveTheCap() public {
        Request memory r = _req(PSEUDONYM, maria, MAX + 1, bytes32("salt-1"));
        vm.expectRevert(abi.encodeWithSelector(AdvanceVault.AmountAboveLimit.selector, MAX));
        _send(r);
    }

    function test_request_oneActiveAdvancePerPseudonym() public {
        uint256 id = _issue();
        Request memory again = _req(PSEUDONYM, maria, 10e6, bytes32("salt-2"));
        vm.expectRevert(abi.encodeWithSelector(AdvanceVault.AdvanceAlreadyActive.selector, id));
        _send(again);

        // Someone else (another pseudonym) is unaffected.
        _send(_req(PSEUDONYM + 1, thief, 10e6, bytes32("salt-3")));

        // Paying it off frees the pseudonym.
        _repay(id, type(uint256).max);
        assertEq(_send(again), 3);
        assertEq(vault.activeAdvanceOf(PSEUDONYM), 3);
    }

    function test_request_revertsOnInvalidProof() public {
        verifier.setResult(false);
        Request memory r = _req(PSEUDONYM, maria, MAX, bytes32("salt-1"));
        vm.expectRevert(AdvanceVault.InvalidProof.selector);
        _send(r);
    }

    function test_request_revertsOnThresholdOutsideU64() public {
        Request memory r = _req(PSEUDONYM, maria, MAX, bytes32("salt-1"));
        r.inputs[4] = bytes32(uint256(type(uint64).max) + 1);
        vm.expectRevert(AdvanceVault.InvalidProof.selector);
        _send(r);
    }

    function test_request_requiresARecentPassport() public {
        // Now is October 2026: a passport ending in August (two months back) is accepted...
        Request memory r = _req(PSEUDONYM, maria, MAX, bytes32("salt-1"));
        r.inputs = _inputs(PSEUDONYM, uint256(r.inputs[6]), SEP_2026 - 1);
        _send(r);

        // ...one ending in July is not.
        r = _req(PSEUDONYM + 1, maria, MAX, bytes32("salt-2"));
        r.inputs = _inputs(PSEUDONYM + 1, uint256(r.inputs[6]), SEP_2026 - 2);
        vm.expectRevert(AdvanceVault.PassportTooOld.selector);
        _send(r);
    }

    function test_request_revertsOnMalformedRequests() public {
        Request memory r = _req(PSEUDONYM, maria, MAX, bytes32("salt-1"));

        bytes32[] memory short = new bytes32[](7);
        vm.expectRevert(AdvanceVault.WrongPublicInputCount.selector);
        vault.requestAdvance(PROOF, short, r.amount, r.recipient, r.deadline, r.salt);

        Request memory zeroTo = _req(PSEUDONYM, address(0), MAX, bytes32("salt-1"));
        vm.expectRevert(AdvanceVault.ZeroAddress.selector);
        _send(zeroTo);

        Request memory zeroAmount = _req(PSEUDONYM, maria, 0, bytes32("salt-1"));
        vm.expectRevert(AdvanceVault.ZeroAmount.selector);
        _send(zeroAmount);
    }

    function test_request_revertsWithoutLiquidity() public {
        vm.prank(lender);
        vault.withdraw(lender, 2_000e6 - MAX + 1);
        Request memory r = _req(PSEUDONYM, maria, MAX, bytes32("salt-1"));
        vm.expectRevert(AdvanceVault.InsufficientLiquidity.selector);
        _send(r);
    }

    // ------------------------------------------------------------ repay

    function test_repay_partialThenFull() public {
        uint256 id = _issue();

        vm.expectEmit(true, true, false, true, address(vault));
        emit AdvanceVault.AdvanceRepaid(id, treasury, 229.5e6, 229.5e6);
        assertEq(_repay(id, 229.5e6), 229.5e6);
        assertEq(vault.remainingOf(id), 229.5e6);
        assertTrue(vault.advances(id).active);
        assertEq(vault.activeAdvanceOf(PSEUDONYM), id);

        vm.expectEmit(true, true, false, true, address(vault));
        emit AdvanceVault.AdvanceRepaid(id, treasury, 229.5e6, 0);
        vm.expectEmit(true, false, false, false, address(vault));
        emit AdvanceVault.AdvanceClosed(id);
        assertEq(_repay(id, 229.5e6), 229.5e6);

        AdvanceVault.Advance memory a = vault.advances(id);
        assertFalse(a.active);
        assertEq(a.repaid, 459e6);
        assertEq(vault.remainingOf(id), 0);
        assertEq(vault.activeAdvanceOf(PSEUDONYM), 0);
        assertEq(ausd.balanceOf(address(vault)), 2_000e6 + 9e6); // principal back plus the fee
        assertEq(ausd.balanceOf(treasury), 10_000e6 - 459e6);
    }

    function test_repay_overpaymentPullsOnlyWhatIsOwed() public {
        uint256 id = _issue();
        assertEq(_repay(id, 1_000e6), 459e6);
        assertEq(ausd.balanceOf(treasury), 10_000e6 - 459e6);
        assertFalse(vault.advances(id).active);
    }

    function test_repay_revertsOnClosedUnknownOrZero() public {
        uint256 id = _issue();
        vm.expectRevert(AdvanceVault.ZeroAmount.selector);
        _repay(id, 0);
        vm.expectRevert(AdvanceVault.AdvanceNotActive.selector);
        _repay(id + 1, 1e6);

        _repay(id, type(uint256).max);
        vm.expectRevert(AdvanceVault.AdvanceNotActive.selector);
        _repay(id, 1e6);
    }

    function test_repay_anyoneCanPay() public {
        uint256 id = _issue();
        address friend = makeAddr("friend");
        ausd.mint(friend, 459e6);
        vm.startPrank(friend);
        ausd.approve(address(vault), 459e6);
        vault.repay(id, 459e6);
        vm.stopPrank();
        assertFalse(vault.advances(id).active);
    }

    function test_repay_revertsWithoutAllowance() public {
        uint256 id = _issue();
        vm.prank(treasury);
        ausd.approve(address(vault), 0);
        vm.expectRevert(AdvanceVault.TokenCallFailed.selector);
        _repay(id, 1e6);
    }

    /// Any sequence of installments repays exactly `owed`, never more, and closes exactly once.
    function testFuzz_repay_math(uint256 amount, uint256[4] memory parts) public {
        amount = bound(amount, 1, MAX);
        Request memory r = _req(PSEUDONYM, maria, amount, bytes32("fuzz"));
        uint256 id = _send(r);
        uint256 owed = vault.advanceOwed(amount);
        assertGe(owed * 10_000, amount * 10_200);
        assertLt(owed * 10_000, amount * 10_200 + 10_000);

        uint256 vaultBefore = ausd.balanceOf(address(vault));
        uint256 total;
        for (uint256 i; i < parts.length && vault.advances(id).active; ++i) {
            uint256 left = vault.remainingOf(id);
            uint256 part = bound(parts[i], 1, owed);
            uint256 paid = _repay(id, part);
            assertEq(paid, part < left ? part : left);
            total += paid;
            assertEq(vault.remainingOf(id), owed - total);
            assertEq(vault.advances(id).active, total < owed);
        }
        if (vault.advances(id).active) total += _repay(id, type(uint256).max);

        assertEq(total, owed);
        assertEq(vault.advances(id).repaid, owed);
        assertEq(ausd.balanceOf(address(vault)), vaultBefore + owed);
        assertEq(vault.activeAdvanceOf(PSEUDONYM), 0);
    }

    // ------------------------------------------------------------ withdraw

    function test_withdraw_onlyLender() public {
        vm.expectRevert(AdvanceVault.NotLender.selector);
        vm.prank(thief);
        vault.withdraw(thief, 1e6);

        vm.startPrank(lender);
        vm.expectRevert(AdvanceVault.ZeroAddress.selector);
        vault.withdraw(address(0), 1e6);
        vm.expectRevert(AdvanceVault.ZeroAmount.selector);
        vault.withdraw(lender, 0);

        vm.expectEmit(true, false, false, true, address(vault));
        emit AdvanceVault.Withdrawn(lender, 500e6);
        vault.withdraw(lender, 500e6);
        vm.stopPrank();
        assertEq(ausd.balanceOf(lender), 500e6);
        assertEq(ausd.balanceOf(address(vault)), 1_500e6);
    }

    // ------------------------------------------------------------ reentrancy

    function test_reentrancy_tokenCallbackIsLocked() public {
        ReentrantToken token = new ReentrantToken();
        AdvanceVault v = new AdvanceVault(
            IERC20(address(token)), IPassportVerifier(address(verifier)), lender, 3000, 200
        );
        token.mint(address(v), 2_000e6);

        // The payout's transfer tries to re-enter `withdraw`...
        token.arm(address(v), abi.encodeCall(AdvanceVault.withdraw, (lender, 1e6)));
        bytes32 salt = bytes32("re");
        uint256 deadline = block.timestamp + 1;
        bytes32[] memory p = _inputs(PSEUDONYM, v.nonceFor(maria, MAX, deadline, salt), SEP_2026);
        p[5] = bytes32(v.scope());
        uint256 id = v.requestAdvance(PROOF, p, MAX, maria, deadline, salt);

        assertTrue(token.attempted());
        assertFalse(token.reentered());
        assertEq(bytes4(token.reentryError()), AdvanceVault.Reentrancy.selector);
        assertEq(token.balanceOf(maria), MAX);

        // ...and a second token callback can't re-enter `repay` either.
        ReentrantToken token2 = new ReentrantToken();
        AdvanceVault v2 = new AdvanceVault(
            IERC20(address(token2)), IPassportVerifier(address(verifier)), lender, 3000, 200
        );
        token2.mint(address(v2), 2_000e6);
        p = _inputs(PSEUDONYM, v2.nonceFor(maria, MAX, deadline, salt), SEP_2026);
        p[5] = bytes32(v2.scope());
        id = v2.requestAdvance(PROOF, p, MAX, maria, deadline, salt);
        token2.mint(treasury, 1_000e6);
        vm.prank(treasury);
        token2.approve(address(v2), type(uint256).max);
        token2.arm(address(v2), abi.encodeCall(AdvanceVault.repay, (id, 1e6)));
        vm.prank(treasury);
        v2.repay(id, 100e6);

        assertFalse(token2.reentered());
        assertEq(bytes4(token2.reentryError()), AdvanceVault.Reentrancy.selector);
        assertEq(v2.remainingOf(id), 459e6 - 100e6);
    }
}
