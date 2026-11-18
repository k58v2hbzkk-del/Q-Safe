# QSafe

**Stablecoin accounts a quantum computer can't drain.**

Every wallet today is protected by an ECDSA key. On **Q-Day**, a large enough quantum computer running Shor's algorithm can work out that key from the wallet's public key and spend everything in it.

QSafe keeps your tUSD8 in an account on QDay Aevum that can **only** be spent with a **hash-based (Winternitz) signature**, checked by the smart contract. Hash functions stay secure against quantum computers, so even an attacker who has cracked your normal wallet key can't move a single tUSD8 out.

Built for the **Aevum Builder Challenge #1** (QDay). Track: business payment tools, with gasless payments.

## What you can do

- **Open a QSafe account** with a quantum-safe key made on your device.
- **Deposit without gas**: your normal wallet signs an EIP-3009 authorization, a relayer submits it.
- **Pay anyone** from QSafe. Your device signs with a one-time hash-based key; a relayer submits, so you never need gas.
- **Pay another QSafe account** directly: the money never leaves quantum protection.
- **Keys rotate on every payment.** Each payment names the next key, so no key is ever used twice.

## Why this matters

| | Normal wallet | QSafe account |
|---|---|---|
| Spending key | ECDSA (secp256k1) | Winternitz one-time signature over keccak256 |
| Broken by a quantum computer? | Yes (Shor's algorithm) | No: only Grover applies, and 256-bit hashes keep ~128-bit security |
| What the attacker can do on Q-Day | Drain the wallet | Nothing. There is no ECDSA path out of the account |

## How it works

```
 your device                         relayer                    QSafe on Aevum
 ───────────                         ───────                    ──────────────
 master secret (stays on device)
   │
   ├─ one-time key k  ──▶ keyHash_k ─────────────────────────▶  open(seed, keyHash_0)
   │
   │  payment: to, amount, nonce k, keyHash_{k+1}
   │  m = paymentDigest(...)
   └─ WOTS sign(m) with key k ──▶ submits pay(...) ────────────▶  WOTS.recover(seed, m, sig) == keyHash_k ?
                                                                 ✓ rotate to keyHash_{k+1}, nonce k+1
                                                                 ✓ send tUSD8 (or credit another QSafe)
```

### Winternitz one-time signatures (contracts/src/WOTS.sol)

- n = 32 bytes, w = 16: the 256-bit message is split into 64 base-16 digits, plus 3 checksum digits = **67 hash chains** of length 15.
- Each chain step is `keccak256(seed ‖ chain index ‖ step ‖ x)`, domain-separated by a per-account public seed.
- Signing reveals position `d_i` of chain `i`; the contract walks the remaining `15 − d_i` steps and compares the result with the stored key commitment `keccak256(seed ‖ end_0 ‖ … ‖ end_66)`.
- The checksum stops an attacker from moving any chain forward to forge a different message.
- Verification costs about **150k gas** in a ~220k-gas payment, about **0.0002 tQDAY** at 1 gwei.

### Safety details

- **One-time keys are enforced on-chain.** The account stores only the current key commitment; every payment must name the next one, and the nonce moves forward. Old signatures are rejected (replay test on-chain).
- **A relayer can't change anything.** The signed digest binds the chain id, contract, account, nonce, payee, amount and next key. Changing any of them invalidates the signature (tested).
- **No ECDSA spending path, no admin, no upgrades, no fees.**
- **Gasless deposits are bound to one account** through the EIP-3009 nonce `keccak256(QSafe, accountId, salt)`.

## Live on QDay Aevum testnet (chain 44005)

Contract address, the deployed commit and every transaction hash of the live walkthrough are in **[deployments/DEMO.md](deployments/DEMO.md)**. The walkthrough shows:

1. Alice and a shop open QSafe accounts
2. A gasless deposit of tUSD8 into Alice's QSafe
3. Alice pays a shop wallet with a hash-based signature
4. Alice pays the shop's QSafe: quantum-safe to quantum-safe
5. **Q-Day attack:** someone holding the depositor's ECDSA key tries to drain the account → **rejected on-chain**
6. **Replay attack:** an old valid signature is resubmitted → **rejected on-chain**
7. The shop spends with its own quantum-safe key

## Run it yourself

Requires [Foundry](https://getfoundry.sh) and Node 22+.

```sh
cd contracts
git clone --depth 1 --branch v5.1.0 https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts
git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std
forge test     # 12 tests: rotation, replay, tampering, forged chunks (fuzzed), ECDSA-can't-withdraw, gasless deposit
forge build
cd .. && npm install
DEPLOYER_KEY=0x... node scripts/live-demo.mjs   # needs ~0.2 tQDAY and 2 tUSD8 on Aevum
```

### The web app

```sh
npm run build                      # bundles app/src → app/dist/app.js (three.js scene + vault)
RELAYER_KEY=0x... npm start        # http://localhost:3000, relayer needs a little tQDAY for gas
```

- Keys are made in the browser. The server only sees key commitments and finished one-time signatures.
- The relayer simulates every call first, is rate-limited per IP and per day, and can't alter a payment: QSafe checks the hash chains itself.
- Deposits are gasless: the user's wallet signs an EIP-3009 `ReceiveWithAuthorization`; the relayer submits it.
- `render.yaml` deploys it to Render (set `RELAYER_KEY` in the dashboard).

`app/src/wots.mjs` is the JavaScript signer (keygen + sign in ~50 ms on a laptop). It is checked against the contract in the live demo before every payment.

The repo's GitHub Action runs the tests, deploys, runs the walkthrough and commits the results to `deployments/` whenever `deploy.txt` changes.

Aevum notes: Shanghai EVM (`evm_version = "shanghai"`, via-IR), legacy transactions, tUSD8 = `0x456569838f1d43009A91ebA4263147Afd7233483` (6 decimals, EIP-3009).

## Limits (honest)

- A QSafe account is quantum-safe; the wallet you deposit **from** is still a normal ECDSA wallet. Move funds into QSafe before Q-Day.
- The master secret on your device must be backed up. Lose it and the account can't be spent.
- A signed payment that never lands must be resubmitted as-is, not re-signed differently: that would reuse a one-time key. The app does this for you.

## Credits

Built by [Tajudeen](https://x.com/Tajudeen). Reuses parts of the QDay Aevum Starter Kit (MIT). See [NOTICE.md](NOTICE.md).

## License

MIT
