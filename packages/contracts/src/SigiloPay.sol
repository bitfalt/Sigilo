// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
}

/// @dev ERC-3009 with an EIP-1271-compatible `bytes` signature (AUSD implements it).
interface IERC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external;
}

/// @dev Agora Instant Settlement pair (all swap calls are on the pair).
interface IAgoraPair {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface IAgoraWhitelister {
    function setApprovedSwapper(address swapper) external;
}

/// @title SigiloPay
/// @notice Stateless payment router for unlinkable payroll (SPEC.md §6.1, §9).
///         - `disperse`: the employer treasury pays every fixed-size piece of a payroll run.
///         - `collect` / `sendHome`: a worker spends several one-time accounts as one payment.
///           Each piece signs an AUSD ERC-3009 ReceiveWithAuthorization (payee = this contract)
///           whose nonce commits to the whole intent, so the relayer that submits it can't change
///           the recipient, the amount or the action, and can't replay it.
/// @dev Holds funds only within a call. No owner, no upgrade path, no stored balances.
///      intentHash = keccak256(abi.encode(action, to, total, minOut, deadline, salt))
///      nonce      = keccak256(abi.encode(intentHash, from))
///      Must match packages/core/src/intent.ts.
contract SigiloPay {
    uint8 public constant ACTION_COLLECT = 0;
    uint8 public constant ACTION_SEND_HOME = 1;
    /// @notice Upper bound on pieces per payment (keeps a payment well under the tx gas limit).
    uint256 public constant MAX_PIECES = 64;

    struct Intent {
        uint8 action;
        address to;
        uint256 total;
        uint256 minOut;
        uint256 deadline;
        bytes32 salt;
    }

    /// @dev validAfter is 0 and validBefore is the intent's deadline; the nonce is derived.
    struct Authorization {
        address from;
        uint256 value;
        bytes signature;
    }

    address public immutable ausd;
    address public immutable ctk;
    IAgoraPair public immutable pair;

    event Dispersed(address indexed payer, uint256 pieces, uint256 total);
    event Paid(
        bytes32 indexed intentHash,
        uint8 indexed action,
        address indexed to,
        uint256 total,
        uint256 amountOut
    );

    error ZeroAddress();
    error LengthMismatch();
    error BadPieceCount();
    error WrongAction();
    error Expired();
    error TotalMismatch();
    error TokenCallFailed();

    /// @param whitelister Agora whitelister to self-register as an approved swapper (testnet), or 0.
    constructor(address ausd_, address ctk_, IAgoraPair pair_, IAgoraWhitelister whitelister) {
        if (ausd_ == address(0) || ctk_ == address(0) || address(pair_) == address(0)) {
            revert ZeroAddress();
        }
        ausd = ausd_;
        ctk = ctk_;
        pair = pair_;
        if (address(whitelister) != address(0)) whitelister.setApprovedSwapper(address(this));
    }

    // ---------------------------------------------------------------- payroll

    /// @notice Pay each `to[i]` `amounts[i]` AUSD from the caller (needs an allowance).
    /// @dev AUSD only: payroll is AUSD, and an arbitrary token could re-enter and fake events.
    function disperse(address[] calldata to, uint256[] calldata amounts) external {
        uint256 n = to.length;
        if (n != amounts.length) revert LengthMismatch();
        uint256 total;
        for (uint256 i; i < n; ++i) {
            if (to[i] == address(0)) revert ZeroAddress();
            _call(ausd, abi.encodeCall(IERC20.transferFrom, (msg.sender, to[i], amounts[i])));
            total += amounts[i];
        }
        emit Dispersed(msg.sender, n, total);
    }

    // ---------------------------------------------------------------- spending

    /// @notice Pull the pieces and forward the total AUSD to `intent.to`.
    function collect(Authorization[] calldata auths, Intent calldata intent)
        external
        returns (bytes32 hash)
    {
        if (intent.action != ACTION_COLLECT) revert WrongAction();
        hash = _pull(auths, intent);
        _call(ausd, abi.encodeCall(IERC20.transfer, (intent.to, intent.total)));
        emit Paid(hash, intent.action, intent.to, intent.total, intent.total);
    }

    /// @notice Pull the pieces, swap the AUSD for CTK on Agora, and deliver it to `intent.to`.
    function sendHome(Authorization[] calldata auths, Intent calldata intent)
        external
        returns (uint256 amountOut)
    {
        if (intent.action != ACTION_SEND_HOME) revert WrongAction();
        bytes32 hash = _pull(auths, intent);

        _call(ausd, abi.encodeCall(IERC20.approve, (address(pair), intent.total)));
        address[] memory path = new address[](2);
        path[0] = ausd;
        path[1] = ctk;
        uint256[] memory amounts = pair.swapExactTokensForTokens(
            intent.total, intent.minOut, path, intent.to, intent.deadline
        );
        amountOut = amounts[amounts.length - 1];
        emit Paid(hash, intent.action, intent.to, intent.total, amountOut);
    }

    function intentHash(Intent calldata intent) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                intent.action, intent.to, intent.total, intent.minOut, intent.deadline, intent.salt
            )
        );
    }

    function authorizationNonce(bytes32 hash, address from) public pure returns (bytes32) {
        return keccak256(abi.encode(hash, from));
    }

    // ---------------------------------------------------------------- internals

    function _pull(Authorization[] calldata auths, Intent calldata intent)
        internal
        returns (bytes32 hash)
    {
        if (intent.to == address(0)) revert ZeroAddress();
        // ERC-3009 requires block.timestamp < validBefore; fail early with a clear error.
        if (block.timestamp >= intent.deadline) revert Expired();
        uint256 n = auths.length;
        if (n == 0 || n > MAX_PIECES) revert BadPieceCount();

        hash = intentHash(intent);
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            Authorization calldata a = auths[i];
            // A wrong recipient, amount, action or deadline changes the nonce, so the
            // signature no longer verifies and AUSD reverts. Used nonces revert too.
            IERC3009(ausd)
                .receiveWithAuthorization(
                    a.from,
                    address(this),
                    a.value,
                    0,
                    intent.deadline,
                    authorizationNonce(hash, a.from),
                    a.signature
                );
            sum += a.value;
        }
        if (sum != intent.total) revert TotalMismatch();
    }

    /// @dev Token call that accepts both bool-returning and non-returning ERC-20s.
    function _call(address token, bytes memory data) internal {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool))) || token.code.length == 0) {
            revert TokenCallFailed();
        }
    }
}
