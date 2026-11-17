// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title WOTS
/// @notice Winternitz one-time signatures (W = 16) over keccak256: a hash-based signature scheme.
///         Its security rests only on the hash function, which quantum computers (Shor's
///         algorithm) cannot break, unlike the ECDSA keys that protect normal wallets.
/// @dev Parameters: n = 32 bytes, w = 16 (4-bit digits), 64 message digits + 3 checksum digits = 67
///      hash chains of length 15. Every chain step is domain-separated by a public seed, the
///      chain index and the step index:  next = keccak256(seed ‖ uint8 chain ‖ uint8 step ‖ x)
///      The public key commitment is keccak256(seed ‖ end_0 ‖ … ‖ end_66).
///      A key must sign exactly one message: signing two different messages with one key lets an
///      attacker forge. QSafe enforces this by rotating to a new key on every spend.
library WOTS {
    uint256 internal constant LEN = 67;
    uint256 internal constant MAX = 15;

    /// @notice The 67 base-16 digits of `m` (64 message digits + 3 checksum digits).
    function digits(bytes32 m) internal pure returns (uint8[67] memory d) {
        uint256 v = uint256(m);
        uint256 sum;
        for (uint256 i; i < 64; ++i) {
            uint8 x = uint8((v >> (252 - 4 * i)) & 0xf);
            d[i] = x;
            sum += MAX - x;
        }
        // sum ≤ 64 * 15 = 960 < 16^3, so three digits hold the checksum
        d[64] = uint8((sum >> 8) & 0xf);
        d[65] = uint8((sum >> 4) & 0xf);
        d[66] = uint8(sum & 0xf);
    }

    /// @notice Walks `steps` links of chain `i` starting at position `from`.
    function chain(bytes32 seed, uint256 i, uint256 from, uint256 steps, bytes32 x) internal pure returns (bytes32 out) {
        assembly ("memory-safe") {
            let p := mload(0x40) // scratch space past the free pointer; not reserved, reused every step
            mstore(p, seed)
            mstore8(add(p, 32), i)
            let end := add(from, steps)
            for { let j := from } lt(j, end) { j := add(j, 1) } {
                mstore8(add(p, 33), j)
                mstore(add(p, 34), x)
                x := keccak256(p, 66)
            }
            out := x
        }
    }

    /// @notice Recovers the public-key commitment a signature over `m` belongs to.
    ///         The signature is valid iff the result equals the expected commitment.
    function recover(bytes32 seed, bytes32 m, bytes32[67] calldata sig) internal pure returns (bytes32) {
        uint8[67] memory d = digits(m);
        bytes32[67] memory ends;
        for (uint256 i; i < LEN; ++i) {
            ends[i] = chain(seed, i, d[i], MAX - d[i], sig[i]);
        }
        return keccak256(abi.encodePacked(seed, ends));
    }
}
