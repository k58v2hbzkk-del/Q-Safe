// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {QSafe} from "../src/QSafe.sol";
import {WOTS} from "../src/WOTS.sol";
import {MockUSD8} from "../src/mocks/MockUSD8.sol";
import {Signing} from "./Signing.sol";

/// @dev Off-chain side of WOTS, written in Solidity for tests (the app does the same in JS).
library Signer {
    function sk(bytes32 master, uint256 keyIndex, uint256 i) internal pure returns (bytes32) {
        return keccak256(abi.encode(master, keyIndex, i));
    }

    function keyHash(bytes32 master, bytes32 seed, uint256 keyIndex) internal pure returns (bytes32) {
        bytes32[67] memory ends;
        for (uint256 i; i < 67; ++i) ends[i] = WOTS.chain(seed, i, 0, 15, sk(master, keyIndex, i));
        return keccak256(abi.encodePacked(seed, ends));
    }

    function sign(bytes32 master, bytes32 seed, uint256 keyIndex, bytes32 m) internal pure returns (bytes32[67] memory s) {
        uint8[67] memory d = WOTS.digits(m);
        for (uint256 i; i < 67; ++i) s[i] = WOTS.chain(seed, i, 0, d[i], sk(master, keyIndex, i));
    }
}

contract QSafeTest is Test {
    MockUSD8 token;
    QSafe q;

    bytes32 constant MASTER = keccak256("alice quantum secret");
    bytes32 constant SEED = keccak256("alice public seed");
    bytes32 constant MASTER_B = keccak256("bob quantum secret");
    bytes32 constant SEED_B = keccak256("bob public seed");

    address alice;
    uint256 aliceKey;
    address shop = makeAddr("shop");
    address relayer = makeAddr("relayer");
    bytes32 idA;
    bytes32 idB;

    function setUp() public {
        (alice, aliceKey) = makeAddrAndKey("alice");
        token = new MockUSD8();
        q = new QSafe(IERC20(address(token)));
        token.mint(alice, 100e6);
        idA = q.open(SEED, Signer.keyHash(MASTER, SEED, 0));
        idB = q.open(SEED_B, Signer.keyHash(MASTER_B, SEED_B, 0));
        vm.startPrank(alice);
        token.approve(address(q), type(uint256).max);
        q.deposit(idA, 10e6);
        vm.stopPrank();
    }

    function _pay(bytes32 id, bytes32 master, bytes32 seed, uint64 k, address to, bytes32 toAcc, uint256 amt)
        internal
        returns (bytes32[67] memory sig, bytes32 next)
    {
        next = Signer.keyHash(master, seed, k + 1);
        sig = Signer.sign(master, seed, k, q.paymentDigest(id, k, to, toAcc, amt, next));
        vm.prank(relayer);
        q.pay(id, to, toAcc, amt, next, sig);
    }

    function test_pay_toAddress_withQuantumSafeSignature() public {
        uint256 g = gasleft();
        _pay(idA, MASTER, SEED, 0, shop, bytes32(0), 3e6);
        emit log_named_uint("gas for a WOTS-verified payment", g - gasleft());
        assertEq(token.balanceOf(shop), 3e6);
        QSafe.Account memory a = q.accountOf(idA);
        assertEq(a.balance, 7e6);
        assertEq(a.nonce, 1);
        assertEq(a.keyHash, Signer.keyHash(MASTER, SEED, 1));
    }

    function test_keysRotate_manyPayments() public {
        for (uint64 k; k < 5; ++k) _pay(idA, MASTER, SEED, k, shop, bytes32(0), 1e6);
        assertEq(token.balanceOf(shop), 5e6);
        assertEq(q.accountOf(idA).nonce, 5);
    }

    function test_pay_toAnotherQSafe_neverLeavesProtection() public {
        _pay(idA, MASTER, SEED, 0, address(0), idB, 4e6);
        assertEq(q.accountOf(idB).balance, 4e6);
        assertEq(token.balanceOf(address(q)), 10e6);
        // bob spends with his own quantum key
        _pay(idB, MASTER_B, SEED_B, 0, shop, bytes32(0), 4e6);
        assertEq(token.balanceOf(shop), 4e6);
    }

    function test_replayRejected() public {
        (bytes32[67] memory sig, bytes32 next) = _pay(idA, MASTER, SEED, 0, shop, bytes32(0), 1e6);
        vm.expectRevert(QSafe.BadSignature.selector);
        q.pay(idA, shop, bytes32(0), 1e6, next, sig);
    }

    function test_relayerCannotChangePayeeAmountOrNextKey() public {
        bytes32 next = Signer.keyHash(MASTER, SEED, 1);
        bytes32[67] memory sig = Signer.sign(MASTER, SEED, 0, q.paymentDigest(idA, 0, shop, bytes32(0), 1e6, next));
        vm.startPrank(relayer);
        vm.expectRevert(QSafe.BadSignature.selector);
        q.pay(idA, relayer, bytes32(0), 1e6, next, sig);
        vm.expectRevert(QSafe.BadSignature.selector);
        q.pay(idA, shop, bytes32(0), 2e6, next, sig);
        vm.expectRevert(QSafe.BadSignature.selector);
        q.pay(idA, shop, bytes32(0), 1e6, keccak256("attacker key"), sig);
        vm.expectRevert(QSafe.BadSignature.selector);
        q.pay(idA, address(0), idB, 1e6, next, sig);
        // the honest submission still works
        q.pay(idA, shop, bytes32(0), 1e6, next, sig);
        vm.stopPrank();
    }

    function test_flippedSignatureChunkRejected(uint8 which) public {
        bytes32 next = Signer.keyHash(MASTER, SEED, 1);
        bytes32[67] memory sig = Signer.sign(MASTER, SEED, 0, q.paymentDigest(idA, 0, shop, bytes32(0), 1e6, next));
        sig[which % 67] = keccak256(abi.encode(sig[which % 67]));
        vm.expectRevert(QSafe.BadSignature.selector);
        q.pay(idA, shop, bytes32(0), 1e6, next, sig);
    }

    function test_wrongSecretRejected() public {
        bytes32 next = Signer.keyHash(MASTER, SEED, 1);
        bytes32[67] memory sig = Signer.sign(MASTER_B, SEED, 0, q.paymentDigest(idA, 0, shop, bytes32(0), 1e6, next));
        vm.expectRevert(QSafe.BadSignature.selector);
        q.pay(idA, shop, bytes32(0), 1e6, next, sig);
    }

    function test_depositorEcdsaKeyCannotWithdraw() public {
        // alice's ECDSA key funded the account, but there is no function it can call to take money out.
        // The only exit is `pay`, which needs the hash-based secret.
        vm.prank(alice);
        vm.expectRevert(QSafe.BadSignature.selector);
        q.pay(idA, alice, bytes32(0), 10e6, keccak256("x"), Signer.sign(keccak256("guess"), SEED, 0, bytes32(0)));
        assertEq(q.accountOf(idA).balance, 10e6);
    }

    function test_overspendRejected() public {
        bytes32 next = Signer.keyHash(MASTER, SEED, 1);
        bytes32[67] memory sig = Signer.sign(MASTER, SEED, 0, q.paymentDigest(idA, 0, shop, bytes32(0), 11e6, next));
        vm.expectRevert(abi.encodeWithSelector(QSafe.InsufficientBalance.selector, 10e6, 11e6));
        q.pay(idA, shop, bytes32(0), 11e6, next, sig);
    }

    function test_gaslessDeposit() public {
        bytes32 salt = keccak256("d1");
        (uint8 v, bytes32 r, bytes32 s) = Signing.signReceive(
            vm,
            aliceKey,
            token.DOMAIN_SEPARATOR(),
            Signing.Auth({from: alice, to: address(q), value: 5e6, validAfter: 0, validBefore: block.timestamp + 1 hours, nonce: q.depositNonce(idB, salt)})
        );
        vm.prank(relayer);
        q.depositWithAuthorization(idB, salt, alice, 5e6, 0, block.timestamp + 1 hours, v, r, s);
        assertEq(q.accountOf(idB).balance, 5e6);
        // the same signature can't be redirected to another account
        (v, r, s) = Signing.signReceive(
            vm,
            aliceKey,
            token.DOMAIN_SEPARATOR(),
            Signing.Auth({from: alice, to: address(q), value: 5e6, validAfter: 0, validBefore: block.timestamp + 1 hours, nonce: q.depositNonce(idB, keccak256("d2"))})
        );
        vm.expectRevert();
        q.depositWithAuthorization(idA, keccak256("d2"), alice, 5e6, 0, block.timestamp + 1 hours, v, r, s);
    }

    function test_openRules() public {
        vm.expectRevert(abi.encodeWithSelector(QSafe.AccountExists.selector, idA));
        q.open(SEED, Signer.keyHash(MASTER, SEED, 0));
        vm.expectRevert(abi.encodeWithSelector(QSafe.NoAccount.selector, bytes32(uint256(1))));
        q.deposit(bytes32(uint256(1)), 1);
    }

    function test_digitsChecksum() public pure {
        uint8[67] memory d = WOTS.digits(bytes32(0));
        // all-zero message: checksum = 64*15 = 960 = 0x3C0
        assertEq(d[64], 3);
        assertEq(d[65], 12);
        assertEq(d[66], 0);
        d = WOTS.digits(bytes32(type(uint256).max));
        assertEq(d[64] + d[65] + d[66], 0);
    }
}
