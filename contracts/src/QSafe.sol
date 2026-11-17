// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {WOTS} from "./WOTS.sol";

/// @notice EIP-3009 (USDC-style) signed transfers. tUSD8 on Aevum implements this.
interface IERC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @title QSafe
/// @notice Quantum-safe stablecoin accounts on QDay Aevum.
///         Money in a QSafe account can only be spent with a hash-based (Winternitz) signature.
///         There is no ECDSA path at all: a quantum computer that recovers a wallet's ECDSA key
///         from its public key still cannot move a single tUSD8 out of the account.
///
///         - Each account has a one-time public key. Every payment is signed with the current key
///           and names the next key, so keys are never reused.
///         - Anyone can deposit, including gasless deposits signed with EIP-3009.
///         - Payments can go to any address, or straight to another QSafe account so the money
///           never leaves quantum protection.
///         - Anyone can submit a signed payment (gasless relay); the signature fixes payee,
///           amount, nonce and next key, so a relayer cannot change any of them.
contract QSafe {
    using SafeERC20 for IERC20;

    struct Account {
        bytes32 keyHash; // commitment to the current one-time WOTS public key
        bytes32 seed; // public WOTS seed, fixed for the account
        uint64 nonce; // number of payments made = index of the current key
        uint64 createdAt;
        uint128 balance;
    }

    IERC20 public immutable token;
    mapping(bytes32 accountId => Account) private _accounts;

    event Opened(bytes32 indexed accountId, bytes32 seed, bytes32 keyHash);
    event Deposited(bytes32 indexed accountId, address indexed from, uint256 amount);
    event Paid(
        bytes32 indexed accountId,
        uint64 indexed nonce,
        address to,
        bytes32 toAccount,
        uint256 amount,
        bytes32 nextKeyHash
    );

    error ZeroValue();
    error AccountExists(bytes32 accountId);
    error NoAccount(bytes32 accountId);
    error BadSignature();
    error InsufficientBalance(uint256 balance, uint256 amount);
    error AmountTooLarge();

    constructor(IERC20 token_) {
        if (address(token_) == address(0)) revert ZeroValue();
        token = token_;
    }

    // ------------------------------------------------------------------ accounts

    /// @notice Opens an account protected by the one-time key `keyHash`. Anyone can open one;
    ///         only the holder of the matching hash-based secret can ever spend from it.
    function open(bytes32 seed, bytes32 keyHash) external returns (bytes32 accountId) {
        if (seed == bytes32(0) || keyHash == bytes32(0)) revert ZeroValue();
        accountId = accountIdOf(seed, keyHash);
        if (_accounts[accountId].keyHash != bytes32(0)) revert AccountExists(accountId);
        _accounts[accountId] = Account({keyHash: keyHash, seed: seed, nonce: 0, createdAt: uint64(block.timestamp), balance: 0});
        emit Opened(accountId, seed, keyHash);
    }

    /// @notice An account's id is fixed by its seed and first key.
    function accountIdOf(bytes32 seed, bytes32 firstKeyHash) public pure returns (bytes32) {
        return keccak256(abi.encode(seed, firstKeyHash));
    }

    // ------------------------------------------------------------------ deposits

    /// @notice Deposit from your approved balance.
    function deposit(bytes32 accountId, uint256 amount) external {
        _credit(accountId, amount);
        emit Deposited(accountId, msg.sender, amount);
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Gasless deposit: `from` signs an EIP-3009 ReceiveWithAuthorization to this contract.
    /// @dev The signed nonce must be `depositNonce(accountId, salt)`, so the signature can only
    ///      credit the account the depositor chose.
    function depositWithAuthorization(
        bytes32 accountId,
        bytes32 salt,
        address from,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        _credit(accountId, amount);
        emit Deposited(accountId, from, amount);
        IERC3009(address(token)).receiveWithAuthorization(
            from, address(this), amount, validAfter, validBefore, depositNonce(accountId, salt), v, r, s
        );
    }

    function depositNonce(bytes32 accountId, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), accountId, salt));
    }

    // ------------------------------------------------------------------ payments

    /// @notice The message a payment signs. Binds chain, contract, account, nonce, payee, amount and next key.
    function paymentDigest(bytes32 accountId, uint64 nonce, address to, bytes32 toAccount, uint256 amount, bytes32 nextKeyHash)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode("QSafe.pay", block.chainid, address(this), accountId, nonce, to, toAccount, amount, nextKeyHash)
        );
    }

    /// @notice Spend from a QSafe account with a Winternitz signature. Anyone may submit it.
    /// @param to          payee address (ignored when `toAccount` is set)
    /// @param toAccount   payee QSafe account, or zero to pay `to`
    /// @param nextKeyHash the account's next one-time key
    /// @param sig         67 WOTS signature chains
    function pay(
        bytes32 accountId,
        address to,
        bytes32 toAccount,
        uint256 amount,
        bytes32 nextKeyHash,
        bytes32[67] calldata sig
    ) external {
        Account storage a = _accounts[accountId];
        if (a.keyHash == bytes32(0)) revert NoAccount(accountId);
        if (amount == 0 || nextKeyHash == bytes32(0)) revert ZeroValue();
        if (toAccount == bytes32(0) && to == address(0)) revert ZeroValue();
        if (amount > a.balance) revert InsufficientBalance(a.balance, amount);

        uint64 nonce = a.nonce;
        bytes32 m = paymentDigest(accountId, nonce, to, toAccount, amount, nextKeyHash);
        if (WOTS.recover(a.seed, m, sig) != a.keyHash) revert BadSignature();

        // rotate the key and debit before any external call
        a.keyHash = nextKeyHash;
        a.nonce = nonce + 1;
        a.balance -= uint128(amount);
        emit Paid(accountId, nonce, to, toAccount, amount, nextKeyHash);

        if (toAccount != bytes32(0)) {
            _credit(toAccount, amount);
        } else {
            token.safeTransfer(to, amount);
        }
    }

    // ------------------------------------------------------------------ views

    function accountOf(bytes32 accountId) external view returns (Account memory) {
        return _accounts[accountId];
    }

    // ------------------------------------------------------------------ internal

    function _credit(bytes32 accountId, uint256 amount) private {
        Account storage a = _accounts[accountId];
        if (a.keyHash == bytes32(0)) revert NoAccount(accountId);
        if (amount == 0) revert ZeroValue();
        uint256 nb = uint256(a.balance) + amount;
        if (nb > type(uint128).max) revert AmountTooLarge();
        a.balance = uint128(nb);
    }
}
