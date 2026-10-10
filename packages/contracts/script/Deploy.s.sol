// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {HonkVerifier} from "../src/generated/HonkVerifier.sol";
import {IncomePassportVerifier} from "../src/IncomePassportVerifier.sol";
import {IAgoraPair, IAgoraWhitelister, SigiloPay} from "../src/SigiloPay.sol";
import {SigiloRegistry} from "../src/SigiloRegistry.sol";

/// @notice Deploy Sigilo to Monad testnet: registry (operated by OPERATOR), passport verifier,
///         and the SigiloPay router (which whitelists itself on Agora).
///         Run the package script `pnpm deploy:testnet` here (reads the root .env).
contract Deploy is Script {
    // Agora testnet, verified on-chain 2026-10-09 (packages/core/src/constants.ts).
    address internal constant AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    address internal constant CTK = 0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D;
    address internal constant PAIR = 0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae;
    address internal constant WHITELISTER = 0x7c10F56d6f04a51376393a1C3670e966863F6BD5;

    function run()
        external
        returns (
            SigiloRegistry registry,
            HonkVerifier honk,
            IncomePassportVerifier passport,
            SigiloPay pay
        )
    {
        require(block.chainid == 10_143, "Monad testnet only");
        address operator = vm.addr(vm.envUint("OPERATOR_PRIVATE_KEY"));

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        registry = new SigiloRegistry(operator);
        honk = new HonkVerifier();
        passport = new IncomePassportVerifier(honk, registry);
        pay = new SigiloPay(AUSD, CTK, IAgoraPair(PAIR), IAgoraWhitelister(WHITELISTER));
        vm.stopBroadcast();

        console.log("NEXT_PUBLIC_SIGILO_REGISTRY_ADDRESS=%s", address(registry));
        console.log("HONK_VERIFIER_ADDRESS=%s", address(honk));
        console.log("NEXT_PUBLIC_PASSPORT_VERIFIER_ADDRESS=%s", address(passport));
        console.log("NEXT_PUBLIC_SIGILO_PAY_ADDRESS=%s", address(pay));
    }
}
