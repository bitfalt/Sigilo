// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SigiloRegistry} from "../src/SigiloRegistry.sol";

contract SigiloRegistryTest is Test {
    SigiloRegistry internal registry;
    address internal operator = makeAddr("operator");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant BN254_R =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    function setUp() public {
        registry = new SigiloRegistry(operator);
    }

    function test_constructor_setsOperator() public view {
        assertEq(registry.operator(), operator);
    }

    function test_constructor_rejectsZeroOperator() public {
        vm.expectRevert(SigiloRegistry.ZeroAddress.selector);
        new SigiloRegistry(address(0));
    }

    function test_publishRoot_onlyOperator() public {
        vm.prank(stranger);
        vm.expectRevert(SigiloRegistry.NotOperator.selector);
        registry.publishRoot(bytes32(uint256(1)));
    }

    function test_publishRoot_updatesStateAndEmits() public {
        bytes32 root = bytes32(uint256(42));
        vm.expectEmit(true, true, false, false, address(registry));
        emit SigiloRegistry.RootPublished(root, 0);
        vm.prank(operator);
        registry.publishRoot(root);

        assertEq(registry.latestRoot(), root);
        assertEq(registry.rootCount(), 1);
        assertTrue(registry.isKnownRoot(root));
        assertFalse(registry.isKnownRoot(bytes32(uint256(43))));
    }

    function test_publishRoot_rejectsZeroAndNonFieldRoots() public {
        vm.startPrank(operator);
        vm.expectRevert(SigiloRegistry.InvalidRoot.selector);
        registry.publishRoot(bytes32(0));
        vm.expectRevert(SigiloRegistry.InvalidRoot.selector);
        registry.publishRoot(bytes32(BN254_R));
        vm.stopPrank();
    }

    function test_isKnownRoot_evictsOldestAfterHistorySize() public {
        uint256 size = registry.ROOT_HISTORY_SIZE();
        vm.startPrank(operator);
        for (uint256 i = 1; i <= size + 1; ++i) {
            registry.publishRoot(bytes32(i));
        }
        vm.stopPrank();

        assertFalse(registry.isKnownRoot(bytes32(uint256(1))), "oldest root evicted");
        assertTrue(registry.isKnownRoot(bytes32(uint256(2))));
        assertTrue(registry.isKnownRoot(bytes32(size + 1)));
        assertFalse(registry.isKnownRoot(bytes32(0)));
    }

    function test_setEmployerVerified() public {
        bytes32 employerId = keccak256("acme-labs");
        vm.prank(operator);
        registry.setEmployerVerified(employerId, true);
        assertTrue(registry.isVerifiedEmployer(employerId));

        vm.prank(stranger);
        vm.expectRevert(SigiloRegistry.NotOperator.selector);
        registry.setEmployerVerified(employerId, false);
    }

    function test_transferOperator() public {
        vm.prank(operator);
        registry.transferOperator(stranger);
        assertEq(registry.operator(), stranger);
    }
}
