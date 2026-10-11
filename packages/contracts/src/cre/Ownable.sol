// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Ownable
/// @notice Single-owner access control with the same interface as OpenZeppelin's Ownable (v5),
///         which Chainlink's ReceiverTemplate inherits. Kept local so the contracts package only
///         depends on forge-std.
abstract contract Ownable {
    address private _owner;

    /// @notice The caller is not the owner.
    error OwnableUnauthorizedAccount(address account);
    /// @notice The owner can't be the zero address.
    error OwnableInvalidOwner(address owner);

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        if (msg.sender != _owner) revert OwnableUnauthorizedAccount(msg.sender);
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert OwnableInvalidOwner(address(0));
        _transferOwnership(initialOwner);
    }

    /// @notice The current owner.
    function owner() public view virtual returns (address) {
        return _owner;
    }

    /// @notice Hand the contract to `newOwner`. Owner only.
    function transferOwnership(address newOwner) public virtual onlyOwner {
        if (newOwner == address(0)) revert OwnableInvalidOwner(address(0));
        _transferOwnership(newOwner);
    }

    /// @notice Leave the contract without an owner, disabling every `onlyOwner` function.
    function renounceOwnership() public virtual onlyOwner {
        _transferOwnership(address(0));
    }

    function _transferOwnership(address newOwner) internal virtual {
        address oldOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}
