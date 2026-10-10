// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {IAgoraPair, IAgoraWhitelister, IERC20, SigiloPay} from "../src/SigiloPay.sol";

interface IAUSD {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function balanceOf(address) external view returns (uint256);
}

interface IAgoraFaucet {
    function requestFunds(address recipient) external;
}

interface IAgoraPairRoles {
    function hasRole(string calldata role, address account) external view returns (bool);
}

/// @dev Spike S2 on a fork of Monad testnet, against the real AUSD and Agora pair:
///      payroll `disperse` → one combined payment from several one-time accounts → swap to CTK.
///      Skipped unless MONAD_TESTNET_RPC_URL is set:
///      MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz forge test --match-contract Fork
contract SigiloPayForkTest is Test {
    // Verified on-chain 2026-10-09 (packages/core/src/constants.ts).
    address internal constant AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    address internal constant CTK = 0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D;
    address internal constant PAIR = 0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae;
    address internal constant WHITELISTER = 0x7c10F56d6f04a51376393a1C3670e966863F6BD5;
    address internal constant FAUCET = 0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C;

    bytes32 internal constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    bool internal forked;
    SigiloPay internal pay;

    function setUp() public {
        string memory rpc = vm.envOr("MONAD_TESTNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        pay = new SigiloPay(AUSD, CTK, IAgoraPair(PAIR), IAgoraWhitelister(WHITELISTER));
    }

    modifier onlyFork() {
        if (!forked) vm.skip(true);
        _;
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
                IAUSD(AUSD).DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        RECEIVE_TYPEHASH, from, address(pay), value, 0, intent.deadline, nonce
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

    /// The domain in packages/core/src/intent.ts (AUSD_TESTNET_DOMAIN) is what AUSD uses.
    function test_fork_ausdDomainMatchesCore() public onlyFork {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("Agora Dollar"),
                keccak256("1"),
                uint256(10_143),
                AUSD
            )
        );
        assertEq(IAUSD(AUSD).DOMAIN_SEPARATOR(), expected);
    }

    function test_fork_payWhitelistsItselfOnAgora() public onlyFork {
        assertTrue(IAgoraPairRoles(PAIR).hasRole("APPROVED_SWAPPER", address(pay)));
    }

    function test_fork_payrollThenSendHome() public onlyFork {
        address treasury = makeAddr("treasury");
        address mom = makeAddr("mom");
        IAgoraFaucet(FAUCET).requestFunds(treasury);
        uint256 funded = IAUSD(AUSD).balanceOf(treasury);
        assertGt(funded, 1_200e6, "faucet drip");

        // Payroll: $1,000 + $200 to two fresh one-time accounts.
        uint256[2] memory keys = [uint256(keccak256("piece-0")), uint256(keccak256("piece-1"))];
        address[] memory to = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        to[0] = vm.addr(keys[0]);
        to[1] = vm.addr(keys[1]);
        amounts[0] = 1_000e6;
        amounts[1] = 200e6;
        vm.startPrank(treasury);
        IERC20(AUSD).approve(address(pay), 1_200e6);
        pay.disperse(to, amounts);
        vm.stopPrank();
        assertEq(IAUSD(AUSD).balanceOf(to[0]), 1_000e6);

        // Send $1,100 home: piece 0 in full, piece 1 partially. The relayer submits.
        SigiloPay.Intent memory intent = SigiloPay.Intent({
            action: pay.ACTION_SEND_HOME(),
            to: mom,
            total: 1_100e6,
            minOut: 1_090e18, // ~1% slippage guard at the 1:1 pair price
            deadline: block.timestamp + 10 minutes,
            salt: keccak256("fork-send-home")
        });
        SigiloPay.Authorization[] memory auths = new SigiloPay.Authorization[](2);
        auths[0] = _sign(keys[0], 1_000e6, intent);
        auths[1] = _sign(keys[1], 100e6, intent);

        vm.prank(makeAddr("relayer"));
        uint256 out = pay.sendHome(auths, intent);

        assertGe(out, intent.minOut);
        assertEq(IERC20Balance(CTK).balanceOf(mom), out);
        assertEq(IAUSD(AUSD).balanceOf(to[0]), 0);
        assertEq(IAUSD(AUSD).balanceOf(to[1]), 100e6, "remainder stays in the piece");
        assertEq(IAUSD(AUSD).balanceOf(address(pay)), 0);
        emit log_named_decimal_uint("CTK delivered", out, 18);
    }
}

interface IERC20Balance {
    function balanceOf(address) external view returns (uint256);
}
