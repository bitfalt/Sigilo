// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {AdvanceVault, IERC20, IPassportVerifier} from "../src/AdvanceVault.sol";
import {HonkVerifier} from "../src/generated/HonkVerifier.sol";
import {IncomePassportVerifier} from "../src/IncomePassportVerifier.sol";
import {SigiloRegistry} from "../src/SigiloRegistry.sol";
import {MockToken} from "./mocks/AgoraMocks.sol";

/// @dev End to end with the real HonkVerifier, IncomePassportVerifier and SigiloRegistry, and a
///      real proof (`pnpm prove:fixture` in packages/circuits → fixtures/advance_proof.json)
///      made for this vault's scope and a nonce bound to the fixture's request.
contract AdvanceVaultProofTest is Test {
    /// 2026-10-10 12:00:00 UTC: the fixture's newest month (September 2026) is recent.
    uint256 internal constant NOW = 1_791_633_600;

    SigiloRegistry internal registry;
    IncomePassportVerifier internal passport;
    MockToken internal ausd;
    AdvanceVault internal vault;

    address internal operator = makeAddr("operator");
    address internal lender = makeAddr("lender");
    address internal relayer = makeAddr("relayer");
    address internal treasury = makeAddr("treasury");
    address internal thief = makeAddr("thief");

    bytes internal proof;
    bytes32[] internal publicInputs;
    address internal recipient;
    uint256 internal amount;
    uint256 internal deadline;
    bytes32 internal salt;

    function setUp() public {
        string memory json = vm.readFile("test/fixtures/advance_proof.json");
        proof = vm.parseJsonBytes(json, ".proof");
        publicInputs = vm.parseJsonBytes32Array(json, ".publicInputs");
        recipient = vm.parseJsonAddress(json, ".recipient");
        amount = vm.parseJsonUint(json, ".amount");
        deadline = vm.parseJsonUint(json, ".deadline");
        salt = vm.parseJsonBytes32(json, ".salt");

        vm.chainId(vm.parseJsonUint(json, ".chainId"));
        vm.warp(NOW);

        registry = new SigiloRegistry(operator);
        passport = new IncomePassportVerifier(new HonkVerifier(), registry);
        ausd = new MockToken("AUSD", "AUSD", 6);

        // Deployed from a fixed account at nonce 0, so the prover knew its scope offline.
        address deployer = vm.parseJsonAddress(json, ".deployer");
        assertEq(vm.getNonce(deployer), 0);
        vm.prank(deployer);
        vault = new AdvanceVault(
            IERC20(address(ausd)), IPassportVerifier(address(passport)), lender, 3000, 200
        );
        assertEq(address(vault), vm.parseJsonAddress(json, ".vault"));
        assertEq(address(vault), vm.computeCreateAddress(deployer, 0));

        ausd.mint(address(vault), 2_000e6);
        ausd.mint(treasury, 1_000e6);
        vm.prank(treasury);
        ausd.approve(address(vault), 459e6);
    }

    function _publishRoot() internal {
        vm.prank(operator);
        registry.publishRoot(publicInputs[0]);
    }

    function test_fixture_isBoundToThisVaultAndRequest() public view {
        assertEq(vault.scope(), uint256(publicInputs[5]));
        assertEq(vault.nonceFor(recipient, amount, deadline, salt), uint256(publicInputs[6]));
        assertEq(uint256(publicInputs[4]), 150_000); // $1,500 a month
        assertEq(vault.maxAdvance(150_000), amount); // asks for the full 30%
    }

    function test_realProof_issuesAdvanceAndPayrollRepaysIt() public {
        _publishRoot();

        vm.prank(relayer);
        uint256 gasBefore = gasleft();
        uint256 id = vault.requestAdvance(proof, publicInputs, amount, recipient, deadline, salt);
        emit log_named_uint("requestAdvance gas", gasBefore - gasleft());

        assertEq(id, 1);
        assertEq(ausd.balanceOf(recipient), 450e6);
        assertEq(vault.activeAdvanceOf(uint256(publicInputs[7])), id);
        assertEq(vault.remainingOf(id), 459e6);

        // Same proof again: replay.
        vm.expectRevert(AdvanceVault.NonceAlreadyUsed.selector);
        vault.requestAdvance(proof, publicInputs, amount, recipient, deadline, salt);

        // Two payroll runs repay it.
        vm.startPrank(treasury);
        gasBefore = gasleft();
        vault.repay(id, 229.5e6);
        emit log_named_uint("repay (installment) gas", gasBefore - gasleft());
        gasBefore = gasleft();
        vault.repay(id, 229.5e6);
        emit log_named_uint("repay (closing) gas", gasBefore - gasleft());
        vm.stopPrank();

        assertFalse(vault.advances(id).active);
        assertEq(vault.activeAdvanceOf(uint256(publicInputs[7])), 0);
        assertEq(ausd.balanceOf(address(vault)), 2_009e6);
    }

    function test_realProof_cannotBeRedirected() public {
        _publishRoot();
        vm.startPrank(thief);
        vm.expectRevert(AdvanceVault.NonceMismatch.selector);
        vault.requestAdvance(proof, publicInputs, amount, thief, deadline, salt);
        vm.expectRevert(AdvanceVault.NonceMismatch.selector);
        vault.requestAdvance(proof, publicInputs, amount - 1, recipient, deadline, salt);
        vm.stopPrank();
    }

    function test_realProof_rejectsUnknownRootAndTampering() public {
        // Root not published yet: IncomePassportVerifier.verify is false.
        vm.expectRevert(AdvanceVault.InvalidProof.selector);
        vault.requestAdvance(proof, publicInputs, amount, recipient, deadline, salt);

        _publishRoot();
        bytes memory bad = proof;
        bad[100] = bytes1(uint8(bad[100]) ^ 0x01);
        vm.expectRevert(AdvanceVault.InvalidProof.selector);
        vault.requestAdvance(bad, publicInputs, amount, recipient, deadline, salt);

        // A different pseudonym with the same proof.
        bytes32[] memory forged = publicInputs;
        forged[7] = bytes32(uint256(forged[7]) ^ 1);
        vm.expectRevert(AdvanceVault.InvalidProof.selector);
        vault.requestAdvance(proof, forged, amount, recipient, deadline, salt);
    }

    function test_realProof_rejectedByAnotherVault() public {
        _publishRoot();
        AdvanceVault other = new AdvanceVault(
            IERC20(address(ausd)), IPassportVerifier(address(passport)), lender, 3000, 200
        );
        ausd.mint(address(other), 1_000e6);
        vm.expectRevert(AdvanceVault.WrongScope.selector);
        other.requestAdvance(proof, publicInputs, amount, recipient, deadline, salt);
    }
}
