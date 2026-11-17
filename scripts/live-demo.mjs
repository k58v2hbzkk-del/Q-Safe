// Deploys QSafe to QDay Aevum testnet and runs a live, on-chain walkthrough.
// Runs in GitHub Actions with the DEPLOYER_KEY secret. Writes deployments/aevum.json and
// deployments/DEMO.md with every transaction hash.
//
//   DEPLOYER_KEY=0x... node scripts/live-demo.mjs               # deploy + demo
//   DEPLOYER_KEY=0x... SKIP_DEPLOY=1 node scripts/live-demo.mjs  # demo again on the deployed contract

import fs from 'node:fs'
import {
  createPublicClient, createWalletClient, defineChain, encodeAbiParameters, formatUnits, http,
  keccak256, parseEther, parseUnits, toBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { keyHash, sign, recover } from '../app/src/wots.mjs'

const aevum = defineChain({
  id: 44005,
  name: 'QDay Aevum Testnet',
  nativeCurrency: { name: 'Test QDAY', symbol: 'tQDAY', decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL ?? 'https://rpc-test.qday.info'] } },
})
const EXPLORER = 'https://explorer-test.qday.info'
const TUSD8 = '0x456569838f1d43009A91ebA4263147Afd7233483'
const ZERO32 = `0x${'0'.repeat(64)}`
const ZERO = '0x0000000000000000000000000000000000000000'

const pkRaw = process.env.DEPLOYER_KEY?.trim()
if (!pkRaw) throw new Error('DEPLOYER_KEY is not set')
const pk = pkRaw.startsWith('0x') ? pkRaw : `0x${pkRaw}`
const deployer = privateKeyToAccount(pk)

// Everything for the demo is derived from the (secret) deployer key, so re-runs are deterministic
// and the quantum secrets never appear anywhere.
const root = keccak256(pk)
const derive = (label) => keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'string' }], [root, label]))
const relayer = privateKeyToAccount(derive('qsafe-demo-relayer'))
const shopWallet = privateKeyToAccount(derive('qsafe-demo-shop-wallet')).address
const alice = { name: 'Alice', master: derive('qsafe-alice-master'), seed: derive('qsafe-alice-seed') }
const shop = { name: 'Corner Shop', master: derive('qsafe-shop-master'), seed: derive('qsafe-shop-seed') }

const pub = createPublicClient({ chain: aevum, transport: http() })
const wallet = (account) => createWalletClient({ account, chain: aevum, transport: http() })
const Q = JSON.parse(fs.readFileSync('contracts/out/QSafe.sol/QSafe.json', 'utf8'))
const erc20 = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }]

const steps = []
const link = (h) => `${EXPLORER}/tx/${h}`
async function tx(label, promise) {
  const hash = await promise
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 })
  steps.push({ label, hash, ok: r.status === 'success', gas: r.gasUsed })
  console.log(`${r.status === 'success' ? '✓' : '✗'} ${label} (gas ${r.gasUsed})\n  ${link(hash)}`)
  if (r.status !== 'success') throw new Error(`${label} failed`)
  return r
}
/** An attack that must fail: sent with a fixed gas limit so the revert is recorded on-chain. */
async function mustFail(label, args, from = relayer) {
  try {
    await pub.simulateContract({ account: from, address: q, abi: Q.abi, functionName: 'pay', args })
    throw new Error(`attack unexpectedly passed: ${label}`)
  } catch (e) {
    if (String(e.message).startsWith('attack unexpectedly')) throw e
  }
  const hash = await wallet(from).writeContract({ address: q, abi: Q.abi, functionName: 'pay', args, gas: 600_000n, type: 'legacy' })
  const r = await pub.waitForTransactionReceipt({ hash })
  steps.push({ label, hash, ok: r.status !== 'success', gas: r.gasUsed })
  console.log(`✓ ${label} → REJECTED on-chain\n  ${link(hash)}`)
  if (r.status === 'success') throw new Error(`attack succeeded: ${label}`)
}

const usd = (n) => parseUnits(String(n), 6)
let q

async function account(who) {
  const first = keyHash(who.master, who.seed, 0)
  const id = await pub.readContract({ address: q, abi: Q.abi, functionName: 'accountIdOf', args: [who.seed, first] })
  let a = await pub.readContract({ address: q, abi: Q.abi, functionName: 'accountOf', args: [id] })
  if (a.keyHash === ZERO32) {
    await tx(`${who.name} opens a QSafe account (only a hash-based key can spend from it)`, wallet(relayer).writeContract({ address: q, abi: Q.abi, functionName: 'open', args: [who.seed, first], type: 'legacy' }))
    a = await pub.readContract({ address: q, abi: Q.abi, functionName: 'accountOf', args: [id] })
  }
  return { ...who, id, a }
}

async function qpay(who, { to = ZERO, toAccount = ZERO32, amount }, label) {
  const a = await pub.readContract({ address: q, abi: Q.abi, functionName: 'accountOf', args: [who.id] })
  const k = Number(a.nonce)
  const next = keyHash(who.master, who.seed, k + 1)
  const m = await pub.readContract({ address: q, abi: Q.abi, functionName: 'paymentDigest', args: [who.id, a.nonce, to, toAccount, amount, next] })
  const sig = sign(who.master, who.seed, k, m)
  if (recover(who.seed, m, sig) !== a.keyHash) throw new Error('local signature check failed')
  await tx(label, wallet(relayer).writeContract({ address: q, abi: Q.abi, functionName: 'pay', args: [who.id, to, toAccount, amount, next, sig], type: 'legacy' }))
  return { m, sig, next, nonce: a.nonce }
}

async function main() {
  const gas = await pub.getBalance({ address: deployer.address })
  const bal = await pub.readContract({ address: TUSD8, abi: erc20, functionName: 'balanceOf', args: [deployer.address] })
  console.log(`deployer ${deployer.address} · tQDAY ${formatUnits(gas, 18)} · tUSD8 ${formatUnits(bal, 6)}`)
  if (bal < usd(2)) throw new Error('need at least 2 tUSD8 in the deployer wallet')

  const prev = fs.existsSync('deployments/aevum.json') ? JSON.parse(fs.readFileSync('deployments/aevum.json', 'utf8')) : null
  if (process.env.SKIP_DEPLOY && prev?.contracts?.QSafe) {
    q = prev.contracts.QSafe
    console.log(`using QSafe ${q}`)
  } else {
    const d = await tx('Deploy QSafe', wallet(deployer).deployContract({ abi: Q.abi, bytecode: Q.bytecode.object, args: [TUSD8], type: 'legacy' }))
    q = d.contractAddress
  }

  if ((await pub.getBalance({ address: relayer.address })) < parseEther('0.02')) {
    await tx('Fund the gasless relayer with tQDAY', wallet(deployer).sendTransaction({ to: relayer.address, value: parseEther('0.1'), type: 'legacy' }))
  }

  const A = await account(alice)
  const S = await account(shop)

  // 1. Gasless deposit: the wallet signs EIP-3009, the relayer submits.
  const salt = keccak256(toBytes(`deposit:${Date.now()}`))
  const amount = usd(2)
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600)
  const nonce = await pub.readContract({ address: q, abi: Q.abi, functionName: 'depositNonce', args: [A.id, salt] })
  const sig = await deployer.signTypedData({
    domain: { name: 'tUSD8', version: '2', chainId: 44005, verifyingContract: TUSD8 },
    types: { ReceiveWithAuthorization: [
      { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
    ] },
    primaryType: 'ReceiveWithAuthorization',
    message: { from: deployer.address, to: q, value: amount, validAfter: 0n, validBefore, nonce },
  })
  await tx('Gasless deposit: wallet signs, relayer moves 2 tUSD8 into Alice\'s QSafe', wallet(relayer).writeContract({
    address: q, abi: Q.abi, functionName: 'depositWithAuthorization',
    args: [A.id, salt, deployer.address, amount, 0n, validBefore, Number(`0x${sig.slice(130, 132)}`), `0x${sig.slice(2, 66)}`, `0x${sig.slice(66, 130)}`],
    type: 'legacy',
  }))

  // 2. Quantum-safe payment to a normal address
  const p1 = await qpay(A, { to: shopWallet, amount: usd(1) }, 'Alice pays 1 tUSD8 to a shop wallet, signed with a Winternitz (hash-based) signature')

  // 3. Quantum-safe to quantum-safe
  await qpay(A, { toAccount: S.id, amount: usd(0.5) }, 'Alice pays 0.5 tUSD8 into the shop\'s QSafe: the money never leaves quantum protection')

  // 4. Attacks
  //  a) "Q-Day": the attacker has the depositor's ECDSA private key (as a quantum computer would) and tries to drain.
  const fake = Array.from({ length: 67 }, (_, i) => keccak256(toBytes(`forged-${i}`)))
  await mustFail('Q-Day attack: attacker holding the ECDSA key tries to drain Alice\'s QSafe', [A.id, deployer.address, ZERO32, usd(0.5), keccak256(toBytes('attacker-key')), fake], deployer)
  //  b) Replay of an old, valid quantum signature
  await mustFail('Replay attack: re-submitting Alice\'s first (already used) signature', [A.id, shopWallet, ZERO32, usd(1), p1.next, p1.sig])

  // 5. Shop spends with its own quantum key
  await qpay(S, { to: shopWallet, amount: usd(0.5) }, 'Shop withdraws 0.5 tUSD8 with its own one-time quantum-safe key')

  const finalA = await pub.readContract({ address: q, abi: Q.abi, functionName: 'accountOf', args: [A.id] })
  const out = {
    chainId: 44005,
    network: 'QDay Aevum Testnet',
    deployedCommit: process.env.SKIP_DEPLOY && prev ? prev.deployedCommit : process.env.GITHUB_SHA ?? 'local',
    contracts: { QSafe: q, tUSD8: TUSD8 },
    demo: { aliceAccount: A.id, shopAccount: S.id, shopWallet, relayer: relayer.address, aliceKeysUsed: Number(finalA.nonce) },
    lastDemo: new Date().toISOString(),
  }
  fs.mkdirSync('deployments', { recursive: true })
  fs.writeFileSync('deployments/aevum.json', JSON.stringify(out, null, 2) + '\n')
  const rows = steps.map((x, i) => `| ${i + 1} | ${x.label} | ${x.gas} | [${x.hash.slice(0, 12)}…](${link(x.hash)}) |`).join('\n')
  const md = `# QSafe live demo on QDay Aevum testnet

Run: ${out.lastDemo} · commit \`${process.env.GITHUB_SHA ?? 'local'}\`

| Contract | Address |
|---|---|
| QSafe | [${q}](${EXPLORER}/address/${q}) |
| tUSD8 | [${TUSD8}](${EXPLORER}/address/${TUSD8}) |

Alice's account \`${A.id}\` · Shop's account \`${S.id}\`

| # | Step | Gas | Transaction |
|---|---|---|---|
${rows}

Steps marked as attacks were sent on purpose and **reverted on-chain** (BadSignature): that is the expected result.
`
  fs.writeFileSync('deployments/DEMO.md', md)
  console.log('\n' + md)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
