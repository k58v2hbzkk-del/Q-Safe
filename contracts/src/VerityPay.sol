// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {VerityDirectory} from "./VerityDirectory.sol";

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

/// @title VerityPay
/// @notice Stablecoin transfers with bank-style safety:
///         1. Confirmation of Payee: the sender can bind a payment to the payee name they expect.
///            If the address does not hold that name in VerityDirectory, the payment reverts.
///         2. New-payee hold: the first payment to someone sits in this contract for `holdPeriod`
///            and the sender can cancel it. Payees you have paid before receive money instantly.
///         3. Gasless: payments and cancels can be signed off-chain and submitted by a relayer.
/// @dev The EIP-3009 nonce commits to the payment id, payee and expected name, so a relayer cannot
///      redirect a signed payment to another address or drop the name check.
contract VerityPay is EIP712 {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Held,
        Released,
        Cancelled
    }

    struct Payment {
        address from;
        address to;
        uint128 amount;
        uint64 releaseAt;
        Status status;
        bool nameChecked;
    }

    bytes32 public constant CANCEL_TYPEHASH = keccak256("Cancel(bytes32 paymentId)");
    uint64 public constant MAX_HOLD = 1 days;

    IERC20 public immutable token;
    VerityDirectory public immutable directory;
    uint64 public immutable holdPeriod;

    mapping(bytes32 paymentId => Payment) private _payments;
    mapping(address from => mapping(address to => bool)) public knownPayee;

    event Sent(
        bytes32 indexed paymentId,
        address indexed from,
        address indexed to,
        uint256 amount,
        uint64 releaseAt,
        bool nameChecked
    );
    event Released(bytes32 indexed paymentId, address indexed to, uint256 amount);
    event Cancelled(bytes32 indexed paymentId, address indexed from, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error HoldTooLong();
    error PaymentExists(bytes32 paymentId);
    error NameMismatch(bytes32 expected, bytes32 registered);
    error NotHeld(bytes32 paymentId);
    error StillHeld(uint64 releaseAt);
    error HoldOver(uint64 releaseAt);
    error NotSender();
    error AmountTooLarge();

    constructor(IERC20 token_, VerityDirectory directory_, uint64 holdPeriod_) EIP712("VerityPay", "1") {
        if (address(token_) == address(0) || address(directory_) == address(0)) revert ZeroAddress();
        if (holdPeriod_ > MAX_HOLD) revert HoldTooLong();
        token = token_;
        directory = directory_;
        holdPeriod = holdPeriod_;
    }

    // ------------------------------------------------------------------ sending

    /// @notice Pay `amount` to `to` from your approved balance.
    /// @param expectedName keccak256 of the payee name you expect, or zero to skip the name check.
    function send(bytes32 paymentId, address to, uint256 amount, bytes32 expectedName) external {
        _open(paymentId, msg.sender, to, amount, expectedName);
        token.safeTransferFrom(msg.sender, address(this), amount);
        _settleIfKnown(paymentId);
    }

    /// @notice Pay with an EIP-3009 `ReceiveWithAuthorization` signed by `from`. Anyone may submit it.
    /// @dev The signed nonce must be `authorizationNonce(paymentId, to, expectedName)`.
    function sendWithAuthorization(
        bytes32 paymentId,
        address from,
        address to,
        uint256 amount,
        bytes32 expectedName,
        uint256 validAfter,
        uint256 validBefore,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        _open(paymentId, from, to, amount, expectedName);
        IERC3009(address(token)).receiveWithAuthorization(
            from,
            address(this),
            amount,
            validAfter,
            validBefore,
            authorizationNonce(paymentId, to, expectedName),
            v,
            r,
            s
        );
        _settleIfKnown(paymentId);
    }

    /// @notice The EIP-3009 nonce a sender must sign for a gasless payment.
    function authorizationNonce(bytes32 paymentId, address to, bytes32 expectedName)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(address(this), paymentId, to, expectedName));
    }

    // ------------------------------------------------------------------ during the hold

    /// @notice Cancel a held payment and get the money back. Only the sender, only during the hold.
    function cancel(bytes32 paymentId) external {
        if (_payments[paymentId].from != msg.sender) revert NotSender();
        _cancel(paymentId);
    }

    /// @notice Gasless cancel: the sender signs `Cancel(paymentId)` and anyone submits it.
    function cancelWithSig(bytes32 paymentId, bytes calldata signature) external {
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CANCEL_TYPEHASH, paymentId)));
        if (ECDSA.recover(digest, signature) != _payments[paymentId].from) revert NotSender();
        _cancel(paymentId);
    }

    /// @notice Deliver a held payment once the hold is over. Anyone may call it.
    function release(bytes32 paymentId) external {
        Payment storage p = _payments[paymentId];
        if (p.status != Status.Held) revert NotHeld(paymentId);
        if (block.timestamp < p.releaseAt) revert StillHeld(p.releaseAt);
        _deliver(paymentId, p);
    }

    // ------------------------------------------------------------------ views

    function paymentOf(bytes32 paymentId) external view returns (Payment memory) {
        return _payments[paymentId];
    }

    /// @notice EIP-712 digest a sender signs to cancel `paymentId` without gas.
    function cancelDigest(bytes32 paymentId) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CANCEL_TYPEHASH, paymentId)));
    }

    // ------------------------------------------------------------------ internal

    function _open(bytes32 paymentId, address from, address to, uint256 amount, bytes32 expectedName) private {
        if (to == address(0) || from == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > type(uint128).max) revert AmountTooLarge();
        if (_payments[paymentId].status != Status.None) revert PaymentExists(paymentId);

        bool checked = expectedName != bytes32(0);
        if (checked) {
            bytes32 registered = directory.nameHashOf(to);
            if (registered != expectedName) revert NameMismatch(expectedName, registered);
        }

        uint64 releaseAt = knownPayee[from][to] ? uint64(block.timestamp) : uint64(block.timestamp) + holdPeriod;
        _payments[paymentId] = Payment({
            from: from,
            to: to,
            amount: uint128(amount),
            releaseAt: releaseAt,
            status: Status.Held,
            nameChecked: checked
        });
        emit Sent(paymentId, from, to, amount, releaseAt, checked);
    }

    function _settleIfKnown(bytes32 paymentId) private {
        Payment storage p = _payments[paymentId];
        if (p.releaseAt <= block.timestamp) _deliver(paymentId, p);
    }

    function _deliver(bytes32 paymentId, Payment storage p) private {
        p.status = Status.Released;
        knownPayee[p.from][p.to] = true;
        emit Released(paymentId, p.to, p.amount);
        token.safeTransfer(p.to, p.amount);
    }

    function _cancel(bytes32 paymentId) private {
        Payment storage p = _payments[paymentId];
        if (p.status != Status.Held) revert NotHeld(paymentId);
        if (block.timestamp >= p.releaseAt) revert HoldOver(p.releaseAt);
        p.status = Status.Cancelled;
        emit Cancelled(paymentId, p.from, p.amount);
        token.safeTransfer(p.from, p.amount);
    }
}
