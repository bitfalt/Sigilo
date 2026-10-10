// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {IAgoraPair, IAgoraWhitelister, SigiloPay} from "../src/SigiloPay.sol";
import {MockAgoraPair, MockAUSD, MockToken} from "./mocks/AgoraMocks.sol";

contract SigiloPayTest is Test {
    MockAUSD internal ausd;
    MockToken internal ctk;
    MockAgoraPair internal pair;
    SigiloPay internal pay;

    address internal treasury = makeAddr("treasury");
    address internal relayer = makeAddr("relayer");
    address internal mom = makeAddr("mom");
    address internal thief = makeAddr("thief");

    // Three one-time accounts (pieces) owned by the same worker.
    uint256[] internal pieceKeys;
    address[] internal pieces;

    function setUp() public {
        vm.warp(1_760_000_000);
        ausd = new MockAUSD();
        ctk = new MockToken("CTK", "CTK", 18);
        pair = new MockAgoraPair(ausd, ctk);
        pay = new SigiloPay(
            address(ausd), address(ctk), IAgoraPair(address(pair)), IAgoraWhitelister(address(pair))
        );

        for (uint256 i = 1; i <= 3; ++i) {
            uint256 key = uint256(keccak256(abi.encode("piece", i)));
            pieceKeys.push(key);
            pieces.push(vm.addr(key));
        }
        // $1,000 + $1,000 + $200.
        ausd.mint(pieces[0], 1_000e6);
        ausd.mint(pieces[1], 1_000e6);
        ausd.mint(pieces[2], 200e6);
    }

    // ------------------------------------------------------------ helpers

    function _intent(uint8 action, address to, uint256 total)
        internal
        view
        returns (SigiloPay.Intent memory)
    {
        return SigiloPay.Intent({
            action: action,
            to: to,
            total: total,
            minOut: action == pay.ACTION_SEND_HOME() ? total * 1e12 : 0,
            deadline: block.timestamp + 10 minutes,
            salt: keccak256(abi.encode(action, to, total))
        });
    }

    function _sign(uint256 key, uint256 value, SigiloPay.Intent memory intent)
        internal
        view
        returns (SigiloPay.Authorization memory)
    {
        address from = vm.addr(key);
        bytes32 nonce = pay.authorizationNonce(pay.intentHash(intent), from);
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                ausd.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        ausd.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                        from,
                        address(pay),
                        value,
                        0,
                        intent.deadline,
                        nonce
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return
            SigiloPay.Authorization({
                from: from, value: value, signature: abi.encodePacked(r, s, v)
            });
    }

    /// $1,200: piece 0 in full, piece 2 in full.
    function _auths1200(SigiloPay.Intent memory intent)
        internal
        view
        returns (SigiloPay.Authorization[] memory auths)
    {
        auths = new SigiloPay.Authorization[](2);
        auths[0] = _sign(pieceKeys[0], 1_000e6, intent);
        auths[1] = _sign(pieceKeys[2], 200e6, intent);
    }

    // ------------------------------------------------------------ vectors

    function test_hashes_matchCoreVectors() public view {
        // Same intent as packages/core/src/stealth.test.ts ("intent hash and nonce").
        SigiloPay.Intent memory intent = SigiloPay.Intent({
            action: 1,
            to: 0x00000000000000000000000000000000DeaDBeef,
            total: 2_400_000_000,
            minOut: 2_390_000_000_000_000_000_000,
            deadline: 1_800_000_000,
            salt: 0xabababababababababababababababababababababababababababababababab
        });
        bytes32 hash = pay.intentHash(intent);
        assertEq(hash, 0xb39f22020643db3dc65b9e8438b7e8bd51fa7f5ba41370d51d7eb477945940b0);
        assertEq(
            pay.authorizationNonce(hash, 0xC2FD88Ffc8c4032cdBfC7c14daC92CE72429C780),
            0x9e6210a1e36765c979160ccf95b69a263beb933efa270b296652e59ee405d61e
        );
    }

    // ------------------------------------------------------------ disperse

    function test_disperse_paysEveryPiece() public {
        ausd.mint(treasury, 2_400e6);
        address[] memory to = new address[](4);
        uint256[] memory amounts = new uint256[](4);
        uint256[4] memory denominations = [uint256(1_000e6), 200e6, 1_000e6, 200e6];
        for (uint256 i; i < 4; ++i) {
            to[i] = makeAddr(string(abi.encode("one-time", i)));
            amounts[i] = denominations[i];
        }
        vm.startPrank(treasury);
        ausd.approve(address(pay), 2_400e6);
        vm.expectEmit(true, true, false, true, address(pay));
        emit SigiloPay.Dispersed(treasury, 4, 2_400e6);
        pay.disperse(to, amounts);
        vm.stopPrank();

        for (uint256 i; i < 4; ++i) {
            assertEq(ausd.balanceOf(to[i]), amounts[i]);
        }
        assertEq(ausd.balanceOf(treasury), 0);
    }

    function test_disperse_rejectsLengthMismatch() public {
        vm.expectRevert(SigiloPay.LengthMismatch.selector);
        pay.disperse(new address[](2), new uint256[](1));
    }

    function test_disperse_failsWithoutAllowance() public {
        ausd.mint(treasury, 10e6);
        address[] memory to = new address[](1);
        to[0] = mom;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10e6;
        vm.prank(treasury);
        vm.expectRevert(SigiloPay.TokenCallFailed.selector);
        pay.disperse(to, amounts);
    }

    // ------------------------------------------------------------ collect

    function test_collect_combinesPiecesIntoOnePayment() public {
        SigiloPay.Intent memory intent = _intent(pay.ACTION_COLLECT(), mom, 1_200e6);
        SigiloPay.Authorization[] memory auths = _auths1200(intent);

        vm.prank(relayer);
        pay.collect(auths, intent);

        assertEq(ausd.balanceOf(mom), 1_200e6);
        assertEq(ausd.balanceOf(pieces[0]), 0);
        assertEq(ausd.balanceOf(pieces[1]), 1_000e6, "untouched piece");
        assertEq(ausd.balanceOf(pieces[2]), 0);
        assertEq(ausd.balanceOf(address(pay)), 0, "router keeps nothing");
    }

    function test_collect_partialPieceKeepsRemainder() public {
        SigiloPay.Intent memory intent = _intent(pay.ACTION_COLLECT(), mom, 1_150e6);
        SigiloPay.Authorization[] memory auths = new SigiloPay.Authorization[](2);
        auths[0] = _sign(pieceKeys[0], 1_000e6, intent);
        auths[1] = _sign(pieceKeys[1], 150e6, intent);

        pay.collect(auths, intent);
        assertEq(ausd.balanceOf(mom), 1_150e6);
        assertEq(ausd.balanceOf(pieces[1]), 850e6);
    }

    function test_collect_relayerCannotRedirect() public {
        SigiloPay.Intent memory intent = _intent(pay.ACTION_COLLECT(), mom, 1_200e6);
        SigiloPay.Authorization[] memory auths = _auths1200(intent);

        intent.to = thief;
        vm.prank(relayer);
        vm.expectRevert("invalid signature");
        pay.collect(auths, intent);
    }

    function test_collect_relayerCannotChangeAmounts() public {
        SigiloPay.Intent memory intent = _intent(pay.ACTION_COLLECT(), mom, 1_200e6);
        SigiloPay.Authorization[] memory auths = _auths1200(intent);

        auths[0].value = 1_000e6 + 1;
        vm.expectRevert("invalid signature");
        pay.collect(auths, intent);
    }

    function test_collect_rejectsTotalMismatch() public {
        SigiloPay.Intent memory intent = _intent(pay.ACTION_COLLECT(), mom, 1_300e6);
        SigiloPay.Authorization[] memory auths = _auths1200(intent);
        vm.expectRevert(SigiloPay.TotalMismatch.selector);
        pay.collect(auths, intent);
    }

    function test_collect_cannotReplay() public {
        SigiloPay.Intent memory intent = _intent(pay.ACTION_COLLECT(), mom, 1_200e6);
        SigiloPay.Authorization[] memory auths = _auths1200(intent);
        pay.collect(auths, intent);

        ausd.mint(pieces[0], 1_000e6);
        ausd.mint(pieces[2], 200e6);
        vm.expectRevert("authorization is used");
        pay.collect(auths, intent);
    }

    function test_collect_rejectsExpired() public {
        SigiloPay.Intent memory intent = _intent(pay.ACTION_COLLECT(), mom, 1_200e6);
        SigiloPay.Authorization[] memory auths = _auths1200(intent);
        vm.warp(intent.deadline);
        vm.expectRevert(SigiloPay.Expired.selector);
        pay.collect(auths, intent);
    }

    function test_collect_rejectsBadPieceCounts() public {
        SigiloPay.Intent memory intent = _intent(pay.ACTION_COLLECT(), mom, 0);
        SigiloPay.Authorization[] memory tooMany =
            new SigiloPay.Authorization[](pay.MAX_PIECES() + 1);
        vm.expectRevert(SigiloPay.BadPieceCount.selector);
        pay.collect(new SigiloPay.Authorization[](0), intent);
        vm.expectRevert(SigiloPay.BadPieceCount.selector);
        pay.collect(tooMany, intent);
    }

    function test_collect_rejectsDuplicatePiece() public {
        SigiloPay.Intent memory intent = _intent(pay.ACTION_COLLECT(), mom, 400e6);
        SigiloPay.Authorization[] memory auths = new SigiloPay.Authorization[](2);
        auths[0] = _sign(pieceKeys[0], 200e6, intent);
        auths[1] = _sign(pieceKeys[0], 200e6, intent);
        vm.expectRevert("authorization is used");
        pay.collect(auths, intent);
    }

    // ------------------------------------------------------------ send home

    function test_sendHome_swapsAndDelivers() public {
        SigiloPay.Intent memory intent = _intent(pay.ACTION_SEND_HOME(), mom, 1_200e6);
        SigiloPay.Authorization[] memory auths = _auths1200(intent);

        vm.prank(relayer);
        uint256 out = pay.sendHome(auths, intent);

        assertEq(out, 1_200e18);
        assertEq(ctk.balanceOf(mom), 1_200e18);
        assertEq(ausd.balanceOf(mom), 0);
        assertEq(ausd.balanceOf(address(pay)), 0);
    }

    function test_sendHome_enforcesMinOut() public {
        SigiloPay.Intent memory intent = _intent(pay.ACTION_SEND_HOME(), mom, 1_200e6);
        intent.minOut = 1_200e18 + 1;
        SigiloPay.Authorization[] memory auths = _auths1200(intent);
        vm.expectRevert("insufficient output");
        pay.sendHome(auths, intent);
    }

    function test_actionIsBound() public {
        SigiloPay.Intent memory intent = _intent(pay.ACTION_COLLECT(), mom, 1_200e6);
        SigiloPay.Authorization[] memory auths = _auths1200(intent);

        vm.expectRevert(SigiloPay.WrongAction.selector);
        pay.sendHome(auths, intent);

        intent.action = pay.ACTION_SEND_HOME();
        intent.minOut = 0;
        vm.expectRevert("invalid signature");
        pay.sendHome(auths, intent);
    }

    /// Any split across the three pieces pays exactly the total and leaves exact remainders.
    function testFuzz_collect_anySplit(uint256 a, uint256 b, uint256 c, bool home) public {
        a = bound(a, 0, 1_000e6);
        b = bound(b, 0, 1_000e6);
        c = bound(c, 1, 200e6);
        uint256 total = a + b + c;
        uint8 action = home ? pay.ACTION_SEND_HOME() : pay.ACTION_COLLECT();
        SigiloPay.Intent memory intent = _intent(action, mom, total);
        SigiloPay.Authorization[] memory auths = new SigiloPay.Authorization[](3);
        auths[0] = _sign(pieceKeys[0], a, intent);
        auths[1] = _sign(pieceKeys[1], b, intent);
        auths[2] = _sign(pieceKeys[2], c, intent);

        if (home) {
            assertEq(pay.sendHome(auths, intent), total * 1e12);
            assertEq(ctk.balanceOf(mom), total * 1e12);
        } else {
            pay.collect(auths, intent);
            assertEq(ausd.balanceOf(mom), total);
        }
        assertEq(ausd.balanceOf(pieces[0]), 1_000e6 - a);
        assertEq(ausd.balanceOf(pieces[1]), 1_000e6 - b);
        assertEq(ausd.balanceOf(pieces[2]), 200e6 - c);
        assertEq(ausd.balanceOf(address(pay)), 0);
    }

    function test_constructor_whitelistsItself() public view {
        assertTrue(pair.approvedSwapper(address(pay)));
    }
}
