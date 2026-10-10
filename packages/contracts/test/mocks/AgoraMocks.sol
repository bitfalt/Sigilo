// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @dev Minimal ERC-20 with open minting, for tests only.
contract MockToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function mint(address to, uint256 value) external {
        balanceOf[to] += value;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        allowance[from][msg.sender] -= value;
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        balanceOf[from] -= value;
        balanceOf[to] += value;
    }
}

/// @dev AUSD stand-in: ERC-3009 `receiveWithAuthorization` (bytes signature) under the same
///      EIP-712 domain as testnet AUSD ("Agora Dollar", version "1").
contract MockAUSD is MockToken {
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 public immutable DOMAIN_SEPARATOR;
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    constructor() MockToken("AUSD", "AUSD", 6) {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("Agora Dollar"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        require(to == msg.sender, "caller must be the payee");
        require(block.timestamp > validAfter, "authorization is not yet valid");
        require(block.timestamp < validBefore, "authorization is expired");
        require(!authorizationState[from][nonce], "authorization is used");
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(
                    abi.encode(
                        RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
                        from,
                        to,
                        value,
                        validAfter,
                        validBefore,
                        nonce
                    )
                )
            )
        );
        require(signature.length == 65, "invalid signature length");
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        require(ecrecover(digest, v, r, s) == from, "invalid signature");
        authorizationState[from][nonce] = true;
        _transfer(from, to, value);
    }
}

/// @dev Agora pair stand-in: AUSD (6 decimals) → CTK (18 decimals) at 1:1, approved swappers
///      only. Also plays the whitelister.
contract MockAgoraPair {
    MockToken public immutable ausd;
    MockToken public immutable ctk;
    mapping(address => bool) public approvedSwapper;

    constructor(MockToken ausd_, MockToken ctk_) {
        ausd = ausd_;
        ctk = ctk_;
    }

    function setApprovedSwapper(address swapper) external {
        approvedSwapper[swapper] = true;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(approvedSwapper[msg.sender], "not an approved swapper");
        require(block.timestamp <= deadline, "expired");
        require(path.length == 2 && path[0] == address(ausd) && path[1] == address(ctk), "path");
        ausd.transferFrom(msg.sender, address(this), amountIn);
        uint256 out = amountIn * 1e12;
        require(out >= amountOutMin, "insufficient output");
        ctk.mint(to, out);
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = out;
    }
}
