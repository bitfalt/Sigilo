// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @dev ERC-165 interface detection, as in OpenZeppelin's IERC165. The Chainlink KeystoneForwarder
///      uses it to check that a receiver implements IReceiver before delivering a report.
interface IERC165 {
    /// @notice Whether the contract implements the interface `interfaceId` (ERC-165).
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}
