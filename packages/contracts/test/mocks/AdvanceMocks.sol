// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @dev IncomePassportVerifier stand-in: accepts or rejects every proof, as the test sets it.
contract MockPassportVerifier {
    bool public result = true;

    function setResult(bool result_) external {
        result = result_;
    }

    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return result;
    }
}

/// @dev ERC-20 whose transfer/transferFrom first call back into `target` with `data` (once), to
///      prove the vault's reentrancy lock. Records the callback's outcome instead of bubbling it.
contract ReentrantToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public target;
    bytes public data;
    bool public attempted;
    bool public reentered;
    bytes public reentryError;

    function mint(address to, uint256 value) external {
        balanceOf[to] += value;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }

    function arm(address target_, bytes calldata data_) external {
        target = target_;
        data = data_;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _hook();
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        _hook();
        allowance[from][msg.sender] -= value;
        _transfer(from, to, value);
        return true;
    }

    function _hook() internal {
        if (target == address(0) || attempted) return;
        attempted = true;
        (reentered, reentryError) = target.call(data);
    }

    function _transfer(address from, address to, uint256 value) internal {
        balanceOf[from] -= value;
        balanceOf[to] += value;
    }
}
