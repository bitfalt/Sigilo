// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {SigiloOracle} from "../src/SigiloOracle.sol";

/// @notice Deploy SigiloOracle, the consumer of the Chainlink CRE "payday" workflow
///         (packages/cre), on Monad testnet. Run the package script `pnpm deploy:oracle` here
///         (reads the root .env). By default it trusts the MockKeystoneForwarder, which is what
///         `cre workflow simulate --broadcast` delivers through; set CRE_FORWARDER to the
///         KeystoneForwarder for a deployed workflow (or call `setForwarderAddress` later).
contract DeploySigiloOracle is Script {
    // Monad testnet (chain selector 2183018362218727504), from `cre workflow supported-chains`
    // on 2026-10-11; both have code on chain.
    address internal constant MOCK_KEYSTONE_FORWARDER = 0xB9F79d863261869B234c481D1f9A7af84AeAd192;
    address internal constant KEYSTONE_FORWARDER = 0xF8344CFd5c43616a4366C34E3EEE75af79a74482;

    function run() external returns (SigiloOracle oracle) {
        require(block.chainid == 10_143, "Monad testnet only");
        address forwarder = vm.envOr("CRE_FORWARDER", MOCK_KEYSTONE_FORWARDER);
        require(
            forwarder == MOCK_KEYSTONE_FORWARDER || forwarder == KEYSTONE_FORWARDER,
            "unknown forwarder"
        );
        require(forwarder.code.length > 0, "forwarder not deployed");

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        oracle = new SigiloOracle(forwarder);
        vm.stopBroadcast();

        console.log("NEXT_PUBLIC_SIGILO_ORACLE_ADDRESS=%s", address(oracle));
        console.log("SIGILO_ORACLE_FORWARDER=%s", forwarder);
    }
}
