# Verity

**Check who you're paying before the money moves.**

Verity brings two safety features banks have and crypto doesn't to stablecoin payments on QDay Aevum:

1. **Confirmation of Payee.** You pay a *name*, not just an address. If the address you pasted doesn't hold that name, the contract refuses the payment.
2. **An undo window for new payees.** The first payment to someone sits in the contract for 10 minutes and you can cancel it. Payees you've paid before get the money instantly.

Payments can be gasless: the sender only signs, and a relayer submits.

Built for the **Aevum Builder Challenge #1**, track **Confirmation of Payee**.

## The problem: address poisoning

Scammers create addresses that look like one you trust: same first and last characters. They send you a tiny transaction from it, so the fake address shows up in your history. The next time you copy "your friend's" address from that history, the money goes to the scammer. This has cost people millions, and nothing on-chain stops it, because to a blockchain any valid address is fine.

Banks solved the same problem with Confirmation of Payee: the bank checks the name on the account before you send. Verity does that on-chain.

## How it works

```
             ┌───────────────────────┐
  payee ───▶ │ VerityDirectory       │  name ⇄ address, 1 name per address,
 setName()   │ "acme.studio" → 0x25…  │  registration time, optional ERC-8004 agent link
             └───────────┬───────────┘
                         │ nameHashOf(to)
             ┌───────────▼───────────┐
 sender ───▶ │ VerityPay             │  1. name check: expected name must match `to`
 send() or   │                       │  2. new payee  → held for holdPeriod (cancellable)
 signs for   │                       │     known payee → delivered instantly
 relayer     └───────────┬───────────┘  3. release() by anyone after the hold
                         │ tUSD8
                         ▼
                       payee
```

### Contracts (`contracts/src`)

| Contract | What it does |
|---|---|
| `VerityDirectory.sol` | Public name directory. One lowercase name (3–32 chars, `a-z 0-9 . - _`) per address, one address per name. Records *when* a name was registered, so apps can warn about brand-new names. Can link an ERC-8004 agent identity the address owns (Aevum's identity registry at `0xF45E…36Be`). |
| `VerityPay.sol` | The payment contract. `send` / `sendWithAuthorization` (gasless, EIP-3009), `cancel` / `cancelWithSig` (gasless cancel, EIP-712), `release`. |

### Safety details

- **The name check is enforced by the contract**, not the app. A payment with `expectedName = keccak256("acme.studio")` to any other address reverts with `NameMismatch`.
- **A relayer can't tamper with a gasless payment.** The EIP-3009 nonce the sender signs is `keccak256(VerityPay, paymentId, to, expectedName)`. Changing the payee or dropping the name check makes the signature invalid.
- **Only the sender can cancel**, only during the hold, and the full amount goes back.
- **Payment ids are single-use.**
- **No admin, no upgrade, no fees.** Nobody can move held funds except by the rules above.

## Live on QDay Aevum testnet (chain 44005)

Contract addresses, the deployed commit and every transaction hash of the live walkthrough are in **[deployments/DEMO.md](deployments/DEMO.md)** and `deployments/aevum.json`. The walkthrough shows:

1. A payee claims the name `acme.studio`
2. A payment to a **lookalike address** labelled `acme.studio` is **blocked on-chain**
3. A payment to the real `acme.studio` is **held**, then **cancelled** and refunded
4. A **gasless** payment: the sender signs, a relayer submits
5. The hold ends, the payment is **released**, and the payee becomes "known"
6. The next payment to the known payee lands **instantly**

## Run it yourself

Requires [Foundry](https://getfoundry.sh) and Node 20+.

```sh
cd contracts
git clone --depth 1 --branch v5.1.0 https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts
git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std
forge test            # 13 tests, including fuzzing and relayer-tampering cases
forge build
cd .. && npm install
DEPLOYER_KEY=0x... node scripts/live-demo.mjs   # needs ~0.1 tQDAY and 3 tUSD8 on Aevum
```

The repo's GitHub Action does the same on every change to `deploy.txt`, using the `DEPLOYER_KEY` repository secret, and commits the results to `deployments/`.

Aevum notes: Shanghai EVM (compiled with `evm_version = "shanghai"`), legacy transactions, tUSD8 = `0x456569838f1d43009A91ebA4263147Afd7233483` (6 decimals, EIP-3009).

## Credits

Built by [Tajudeen](https://x.com/Tajudeen). Reuses parts of the QDay Aevum Starter Kit (MIT). See [NOTICE.md](NOTICE.md).

## License

MIT
