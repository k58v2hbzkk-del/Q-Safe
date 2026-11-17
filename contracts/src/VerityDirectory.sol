// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal ERC-721 view used to read the ERC-8004-style identity registry on Aevum.
interface IERC721OwnerOf {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title VerityDirectory
/// @notice A public directory of payee names, used for Confirmation of Payee.
///         Every address can claim one human-readable name (like "acme.studio"). Before money moves,
///         wallets look up the name behind an address, or check that the name a sender typed
///         matches the address they are paying.
/// @dev Names are lowercase [a-z0-9 . - _], 3 to 32 characters, one per address and one address per
///      name. `since` records when a name was (re)registered, so apps can warn about brand-new names,
///      a common sign of impersonation. An address can also link an ERC-8004 agent identity it owns.
contract VerityDirectory {
    struct Entry {
        string name;
        uint64 since;
        uint256 agentId; // 0 when no ERC-8004 identity is linked
    }

    /// @notice ERC-8004-style identity registry (ERC-721). address(0) disables agent linking.
    IERC721OwnerOf public immutable identityRegistry;

    mapping(address account => Entry) private _entries;
    mapping(bytes32 nameHash => address account) public addressOfName;

    event NameSet(address indexed account, bytes32 indexed nameHash, string name);
    event NameCleared(address indexed account, bytes32 indexed nameHash);
    event AgentLinked(address indexed account, uint256 indexed agentId);

    error InvalidName();
    error NameTaken(address owner);
    error NotAgentOwner();
    error NoIdentityRegistry();

    constructor(IERC721OwnerOf identityRegistry_) {
        identityRegistry = identityRegistry_;
    }

    /// @notice Claim `name` for the caller, replacing any name the caller had.
    function setName(string calldata name) external {
        bytes32 h = hashName(name);
        address current = addressOfName[h];
        if (current == msg.sender) return;
        if (current != address(0)) revert NameTaken(current);

        Entry storage e = _entries[msg.sender];
        if (bytes(e.name).length != 0) {
            bytes32 old = keccak256(bytes(e.name));
            delete addressOfName[old];
            emit NameCleared(msg.sender, old);
        }
        e.name = name;
        e.since = uint64(block.timestamp);
        addressOfName[h] = msg.sender;
        emit NameSet(msg.sender, h, name);
    }

    /// @notice Give up the caller's name.
    function clearName() external {
        Entry storage e = _entries[msg.sender];
        if (bytes(e.name).length == 0) return;
        bytes32 old = keccak256(bytes(e.name));
        delete addressOfName[old];
        e.name = "";
        e.since = 0;
        emit NameCleared(msg.sender, old);
    }

    /// @notice Link an ERC-8004 agent identity the caller owns, shown as an extra trust signal.
    function linkAgent(uint256 agentId) external {
        if (address(identityRegistry) == address(0)) revert NoIdentityRegistry();
        address owner;
        try identityRegistry.ownerOf(agentId) returns (address o) {
            owner = o;
        } catch {
            revert NotAgentOwner();
        }
        if (owner != msg.sender) revert NotAgentOwner();
        _entries[msg.sender].agentId = agentId;
        emit AgentLinked(msg.sender, agentId);
    }

    /// @notice Name, registration time and linked agent of `account` (empty name if none).
    function entryOf(address account) external view returns (Entry memory) {
        return _entries[account];
    }

    /// @notice keccak256 of the name of `account`, or zero if it has none.
    function nameHashOf(address account) public view returns (bytes32) {
        bytes memory n = bytes(_entries[account].name);
        return n.length == 0 ? bytes32(0) : keccak256(n);
    }

    /// @notice Validates `name` and returns its hash. Reverts on invalid names.
    function hashName(string calldata name) public pure returns (bytes32) {
        bytes calldata b = bytes(name);
        if (b.length < 3 || b.length > 32) revert InvalidName();
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            bool ok = (c >= 0x61 && c <= 0x7a) // a-z
                || (c >= 0x30 && c <= 0x39) // 0-9
                || c == 0x2e || c == 0x2d || c == 0x5f; // . - _
            if (!ok) revert InvalidName();
        }
        return keccak256(b);
    }
}
