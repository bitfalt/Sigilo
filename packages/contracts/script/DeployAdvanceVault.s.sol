// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {AdvanceVault, IERC20, IPassportVerifier} from "../src/AdvanceVault.sol";

/// @notice Deploy the AdvanceVault (SPEC.md F7) on Monad testnet against the already-deployed
///         IncomePassportVerifier (packages/core/src/deployments.ts). The lender funds it with a
///         plain AUSD transfer afterwards. Run the package script `pnpm deploy:vault` here
///         (reads the root .env).
contract DeployAdvanceVault is Script {
    // Agora testnet AUSD (packages/core/src/constants.ts).
    address internal constant AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    // Verified on MonadVision 2026-10-09 (packages/core/src/deployments.ts).
    address internal constant PASSPORT_VERIFIER = 0x0e40B46A82a79C0a4b0A9957bBD32AE6B5a4B290;
    // The demo lender, "Fondo Quincena" (packages/core/src/verify.ts DEMO_LENDER).
    address internal constant LENDER = 0xf76E8721D6d893D8078c18F93C4689C13A0bFC2d;
    // Up to 30% of the proven monthly income, 2% fee (core DEMO_ADVANCE_TERMS).
    uint16 internal constant MAX_RATIO_BPS = 3000;
    uint16 internal constant FEE_BPS = 200;

    function run() external returns (AdvanceVault vault) {
        require(block.chainid == 10_143, "Monad testnet only");
        require(AUSD.code.length > 0, "AUSD not deployed");
        require(PASSPORT_VERIFIER.code.length > 0, "passport verifier not deployed");

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        vault = new AdvanceVault(
            IERC20(AUSD), IPassportVerifier(PASSPORT_VERIFIER), LENDER, MAX_RATIO_BPS, FEE_BPS
        );
        vm.stopBroadcast();

        console.log("NEXT_PUBLIC_ADVANCE_VAULT_ADDRESS=%s", address(vault));
        console.log("ADVANCE_VAULT_SCOPE=%s", vm.toString(bytes32(vault.scope())));
    }
}
