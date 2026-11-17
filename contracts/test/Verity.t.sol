// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {VerityDirectory, IERC721OwnerOf} from "../src/VerityDirectory.sol";
import {VerityPay} from "../src/VerityPay.sol";
import {MockUSD8} from "../src/mocks/MockUSD8.sol";
import {Signing} from "./Signing.sol";

contract MockIdentity is ERC721("Agent", "AGENT") {
    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}

contract VerityTest is Test {
    MockUSD8 token;
    MockIdentity identity;
    VerityDirectory dir;
    VerityPay pay;

    address alice;
    uint256 aliceKey;
    address bob = makeAddr("bob"); // real payee
    address mallory = makeAddr("mallory"); // lookalike scammer
    address relayer = makeAddr("relayer");

    uint64 constant HOLD = 10 minutes;
    uint256 constant AMT = 2e6;

    function setUp() public {
        (alice, aliceKey) = makeAddrAndKey("alice");
        token = new MockUSD8();
        identity = new MockIdentity();
        dir = new VerityDirectory(IERC721OwnerOf(address(identity)));
        pay = new VerityPay(IERC20(address(token)), dir, HOLD);
        token.mint(alice, 100e6);
        vm.prank(bob);
        dir.setName("bob.studio");
        vm.prank(alice);
        token.approve(address(pay), type(uint256).max);
    }

    function _h(string memory n) internal pure returns (bytes32) {
        return keccak256(bytes(n));
    }

    // ---------------- directory

    function test_directory_namesAreUniqueAndValidated() public {
        assertEq(dir.addressOfName(_h("bob.studio")), bob);
        assertEq(dir.nameHashOf(bob), _h("bob.studio"));
        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(VerityDirectory.NameTaken.selector, bob));
        dir.setName("bob.studio");
        vm.startPrank(mallory);
        vm.expectRevert(VerityDirectory.InvalidName.selector);
        dir.setName("Bob.Studio"); // uppercase not allowed
        vm.expectRevert(VerityDirectory.InvalidName.selector);
        dir.setName("ab");
        vm.stopPrank();
    }

    function test_directory_renameFreesOldName() public {
        vm.prank(bob);
        dir.setName("bob.design");
        assertEq(dir.addressOfName(_h("bob.studio")), address(0));
        assertEq(dir.addressOfName(_h("bob.design")), bob);
        assertEq(dir.entryOf(bob).since, block.timestamp);
    }

    function test_directory_linkAgentRequiresOwnership() public {
        identity.mint(bob, 7);
        vm.prank(mallory);
        vm.expectRevert(VerityDirectory.NotAgentOwner.selector);
        dir.linkAgent(7);
        vm.prank(bob);
        dir.linkAgent(7);
        assertEq(dir.entryOf(bob).agentId, 7);
        vm.prank(bob);
        vm.expectRevert(VerityDirectory.NotAgentOwner.selector);
        dir.linkAgent(999); // does not exist
    }

    // ---------------- confirmation of payee

    function test_nameCheck_blocksWrongAddress() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VerityPay.NameMismatch.selector, _h("bob.studio"), bytes32(0)));
        pay.send(keccak256("p1"), mallory, AMT, _h("bob.studio"));
        assertEq(token.balanceOf(alice), 100e6);
    }

    function test_nameCheck_passesRightAddress() public {
        vm.prank(alice);
        pay.send(keccak256("p1"), bob, AMT, _h("bob.studio"));
        VerityPay.Payment memory p = pay.paymentOf(keccak256("p1"));
        assertTrue(p.nameChecked);
        assertEq(uint8(p.status), uint8(VerityPay.Status.Held));
    }

    // ---------------- hold, cancel, release

    function test_newPayee_isHeld_thenCancelRefunds() public {
        bytes32 id = keccak256("p1");
        vm.prank(alice);
        pay.send(id, bob, AMT, bytes32(0));
        assertEq(token.balanceOf(address(pay)), AMT);
        assertEq(token.balanceOf(bob), 0);

        vm.prank(mallory);
        vm.expectRevert(VerityPay.NotSender.selector);
        pay.cancel(id);

        vm.prank(alice);
        pay.cancel(id);
        assertEq(token.balanceOf(alice), 100e6);
        assertFalse(pay.knownPayee(alice, bob));
    }

    function test_release_afterHold_thenKnownPayeeIsInstant() public {
        bytes32 id = keccak256("p1");
        vm.prank(alice);
        pay.send(id, bob, AMT, _h("bob.studio"));

        vm.expectRevert(abi.encodeWithSelector(VerityPay.StillHeld.selector, uint64(block.timestamp + HOLD)));
        pay.release(id);

        vm.warp(block.timestamp + HOLD);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VerityPay.HoldOver.selector, uint64(block.timestamp)));
        pay.cancel(id);

        vm.prank(relayer);
        pay.release(id);
        assertEq(token.balanceOf(bob), AMT);
        assertTrue(pay.knownPayee(alice, bob));

        // second payment to a known payee lands immediately
        vm.prank(alice);
        pay.send(keccak256("p2"), bob, AMT, bytes32(0));
        assertEq(token.balanceOf(bob), 2 * AMT);
        assertEq(uint8(pay.paymentOf(keccak256("p2")).status), uint8(VerityPay.Status.Released));
    }

    function test_paymentIdCannotBeReused() public {
        bytes32 id = keccak256("p1");
        vm.startPrank(alice);
        pay.send(id, bob, AMT, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(VerityPay.PaymentExists.selector, id));
        pay.send(id, bob, AMT, bytes32(0));
        vm.stopPrank();
    }

    // ---------------- gasless

    function _sign(bytes32 id, address to, bytes32 expected, uint256 amount)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        return Signing.signReceive(
            vm,
            aliceKey,
            token.DOMAIN_SEPARATOR(),
            Signing.Auth({
                from: alice,
                to: address(pay),
                value: amount,
                validAfter: 0,
                validBefore: block.timestamp + 1 hours,
                nonce: pay.authorizationNonce(id, to, expected)
            })
        );
    }

    function test_gasless_sendAndCancel() public {
        bytes32 id = keccak256("g1");
        (uint8 v, bytes32 r, bytes32 s) = _sign(id, bob, _h("bob.studio"), AMT);
        vm.prank(relayer);
        pay.sendWithAuthorization(id, alice, bob, AMT, _h("bob.studio"), 0, block.timestamp + 1 hours, v, r, s);
        assertEq(token.balanceOf(address(pay)), AMT);

        (uint8 cv, bytes32 cr, bytes32 cs) = vm.sign(aliceKey, pay.cancelDigest(id));
        vm.prank(relayer);
        pay.cancelWithSig(id, abi.encodePacked(cr, cs, cv));
        assertEq(token.balanceOf(alice), 100e6);
    }

    function test_gasless_relayerCannotRedirect() public {
        bytes32 id = keccak256("g1");
        (uint8 v, bytes32 r, bytes32 s) = _sign(id, bob, bytes32(0), AMT);
        vm.prank(relayer);
        vm.expectRevert(); // nonce no longer matches: signature invalid
        pay.sendWithAuthorization(id, alice, mallory, AMT, bytes32(0), 0, block.timestamp + 1 hours, v, r, s);
    }

    function test_gasless_relayerCannotDropNameCheck() public {
        bytes32 id = keccak256("g1");
        (uint8 v, bytes32 r, bytes32 s) = _sign(id, bob, _h("bob.studio"), AMT);
        vm.prank(relayer);
        vm.expectRevert();
        pay.sendWithAuthorization(id, alice, bob, AMT, bytes32(0), 0, block.timestamp + 1 hours, v, r, s);
    }

    function test_cancelWithSig_rejectsOthers() public {
        bytes32 id = keccak256("p1");
        vm.prank(alice);
        pay.send(id, bob, AMT, bytes32(0));
        (, uint256 malKey) = makeAddrAndKey("mallory2");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(malKey, pay.cancelDigest(id));
        vm.expectRevert(VerityPay.NotSender.selector);
        pay.cancelWithSig(id, abi.encodePacked(r, s, v));
    }

    function testFuzz_holdAlwaysRefundsExactly(uint96 amount) public {
        amount = uint96(bound(amount, 1, 100e6));
        bytes32 id = keccak256(abi.encode(amount));
        vm.startPrank(alice);
        pay.send(id, bob, amount, bytes32(0));
        pay.cancel(id);
        vm.stopPrank();
        assertEq(token.balanceOf(alice), 100e6);
        assertEq(token.balanceOf(address(pay)), 0);
    }
}
