// Deploys Verity to QDay Aevum testnet and runs a live, on-chain walkthrough of every feature.
// Runs in GitHub Actions with the DEPLOYER_KEY secret. Writes deployments/aevum.json and
// deployments/DEMO.md with every transaction hash, so judges can check each step on the explorer.
//
//   DEPLOYER_KEY=0x... node scripts/live-demo.mjs            # deploy + demo
//   DEPLOYER_KEY=0x... SKIP_DEPLOY=1 node scripts/live-demo.mjs  # demo again on existing contracts

import fs from 'node:fs'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  formatUnits,
  http,
  keccak256,
  parseEther,
  parseUnits,
  toBytes,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const aevum = defineChain({
  id: 44005,
  name: 'QDay Aevum Testnet',
  nativeCurrency: { name: 'Test QDAY', symbol: 'tQDAY', decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL ?? 'https://rpc-test.qday.info'] } },
  blockExplorers: { default: { name: 'Aevum Explorer', url: 'https://explorer-test.qday.info' } },
})
const EXPLORER = 'https://explorer-test.qday.info'
const TUSD8 = '0x456569838f1d43009A91ebA4263147Afd7233483'
const IDENTITY_REGISTRY = '0xF45E7f39Caba1d2055f613970575a7e7069636Be'
const HOLD_SECONDS = BigInt(process.env.HOLD_SECONDS ?? 600)

const pk = process.env.DEPLOYER_KEY?.trim()
if (!pk) throw new Error('DEPLOYER_KEY is not set')
const deployer = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`)

// Demo accounts are derived from the deployer key, so re-runs reuse the same addresses.
const seed = keccak256(pk.startsWith('0x') ? pk : `0x${pk}`)
const derive = (label) =>
  privateKeyToAccount(keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'string' }], [seed, label])))
const acme = derive('verity-demo-acme-studio') // the real payee
const relayer = derive('verity-demo-relayer') // submits gasless payments

const pub = createPublicClient({ chain: aevum, transport: http() })
const wallet = (account) => createWalletClient({ account, chain: aevum, transport: http() })

const artifact = (name) => JSON.parse(fs.readFileSync(`contracts/out/${name}.sol/${name}.json`, 'utf8'))
const Directory = artifact('VerityDirectory')
const Pay = artifact('VerityPay')

const erc20 = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
]

const steps = []
const link = (h) => `${EXPLORER}/tx/${h}`
async function tx(label, promise) {
  const hash = await promise
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 })
  const ok = r.status === 'success'
  steps.push({ label, hash, ok, block: Number(r.blockNumber) })
  console.log(`${ok ? '✓' : '✗'} ${label}\n  ${link(hash)}`)
  return r
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const usd = (n) => parseUnits(String(n), 6)
const nameHash = (n) => keccak256(toBytes(n))
const newId = (tag) => keccak256(toBytes(`verity:${tag}:${Date.now()}:${Math.random()}`))

/** Make an address that looks like `target` at a glance: same first 2 and last 2 hex characters. */
function lookalike(target) {
  const want = target.toLowerCase()
  for (let i = 0; i < 2_000_000; i++) {
    const key = generatePrivateKey()
    const a = privateKeyToAccount(key).address.toLowerCase()
    if (a.slice(2, 4) === want.slice(2, 4) && a.slice(-2) === want.slice(-2)) return privateKeyToAccount(key)
  }
  throw new Error('no lookalike found')
}

async function main() {
  console.log(`deployer ${deployer.address}`)
  const gas = await pub.getBalance({ address: deployer.address })
  const bal = await pub.readContract({ address: TUSD8, abi: erc20, functionName: 'balanceOf', args: [deployer.address] })
  console.log(`tQDAY ${formatUnits(gas, 18)} · tUSD8 ${formatUnits(bal, 6)}`)
  if (bal < usd(3)) throw new Error('need at least 3 tUSD8 in the deployer wallet')

  // ---------------------------------------------------------------- deploy
  let dir, pay
  const prev = fs.existsSync('deployments/aevum.json') ? JSON.parse(fs.readFileSync('deployments/aevum.json', 'utf8')) : null
  if (process.env.SKIP_DEPLOY && prev) {
    ;({ VerityDirectory: dir, VerityPay: pay } = prev.contracts)
    console.log(`using deployed contracts ${dir} ${pay}`)
  } else {
    const registryCode = await pub.getCode({ address: IDENTITY_REGISTRY })
    const registry = registryCode && registryCode !== '0x' ? IDENTITY_REGISTRY : '0x0000000000000000000000000000000000000000'
    const d1 = await tx('Deploy VerityDirectory', wallet(deployer).deployContract({ abi: Directory.abi, bytecode: Directory.bytecode.object, args: [registry], type: 'legacy' }))
    dir = d1.contractAddress
    const d2 = await tx('Deploy VerityPay', wallet(deployer).deployContract({ abi: Pay.abi, bytecode: Pay.bytecode.object, args: [TUSD8, dir, HOLD_SECONDS], type: 'legacy' }))
    pay = d2.contractAddress
  }
  const commit = process.env.GITHUB_SHA ?? 'local'

  // ---------------------------------------------------------------- setup: names and gas for demo accounts
  for (const a of [acme, relayer]) {
    if ((await pub.getBalance({ address: a.address })) < parseEther('0.01')) {
      await tx(`Fund demo account ${a.address.slice(0, 8)}… with gas`, wallet(deployer).sendTransaction({ to: a.address, value: parseEther('0.03'), type: 'legacy' }))
    }
  }
  const acmeName = 'acme.studio'
  const current = await pub.readContract({ address: dir, abi: Directory.abi, functionName: 'nameHashOf', args: [acme.address] })
  if (current !== nameHash(acmeName)) {
    await tx(`Payee claims the name "${acmeName}"`, wallet(acme).writeContract({ address: dir, abi: Directory.abi, functionName: 'setName', args: [acmeName], type: 'legacy' }))
  }
  await tx('Sender approves VerityPay (for non-gasless payments)', wallet(deployer).writeContract({ address: TUSD8, abi: erc20, functionName: 'approve', args: [pay, usd(100)], type: 'legacy' }))

  // ---------------------------------------------------------------- 1. lookalike address is blocked
  const mallory = lookalike(acme.address)
  console.log(`lookalike: real ${acme.address} vs fake ${mallory.address}`)
  let blocked = false
  try {
    await pub.simulateContract({ account: deployer, address: pay, abi: Pay.abi, functionName: 'send', args: [newId('poison'), mallory.address, usd(1), nameHash(acmeName)] })
  } catch {
    blocked = true // the contract refused the payment
  }
  // Also send it for real with a fixed gas limit, so the revert is visible on the explorer.
  const poisonHash = await wallet(deployer).writeContract({ address: pay, abi: Pay.abi, functionName: 'send', args: [newId('poison'), mallory.address, usd(1), nameHash(acmeName)], gas: 200_000n, type: 'legacy' })
  const pr = await pub.waitForTransactionReceipt({ hash: poisonHash })
  steps.push({ label: `Payment to lookalike ${mallory.address} as "${acmeName}" → BLOCKED on-chain (NameMismatch)`, hash: poisonHash, ok: pr.status !== 'success', block: Number(pr.blockNumber) })
  console.log(`✓ lookalike blocked (reverted as intended): ${link(poisonHash)}`)

  // ---------------------------------------------------------------- 2. new payee: held, then cancelled (undo)
  const idCancel = newId('cancel')
  await tx(`Send 1 tUSD8 to "${acmeName}" (new payee → held ${HOLD_SECONDS}s)`, wallet(deployer).writeContract({ address: pay, abi: Pay.abi, functionName: 'send', args: [idCancel, acme.address, usd(1), nameHash(acmeName)], type: 'legacy' }))
  await tx('Sender changes their mind → cancel (undo) → refunded', wallet(deployer).writeContract({ address: pay, abi: Pay.abi, functionName: 'cancel', args: [idCancel], type: 'legacy' }))

  // ---------------------------------------------------------------- 3. gasless payment, signed by sender, submitted by relayer
  const idGasless = newId('gasless')
  const amount = usd(1)
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600)
  const nonce = await pub.readContract({ address: pay, abi: Pay.abi, functionName: 'authorizationNonce', args: [idGasless, acme.address, nameHash(acmeName)] })
  const sig = await deployer.signTypedData({
    domain: { name: 'tUSD8', version: '2', chainId: 44005, verifyingContract: TUSD8 },
    types: { ReceiveWithAuthorization: [
      { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
    ] },
    primaryType: 'ReceiveWithAuthorization',
    message: { from: deployer.address, to: pay, value: amount, validAfter: 0n, validBefore, nonce },
  })
  const r = `0x${sig.slice(2, 66)}`
  const s = `0x${sig.slice(66, 130)}`
  const v = Number(`0x${sig.slice(130, 132)}`)
  await tx(`Gasless: sender signs, relayer submits 1 tUSD8 to "${acmeName}" (held)`, wallet(relayer).writeContract({ address: pay, abi: Pay.abi, functionName: 'sendWithAuthorization', args: [idGasless, deployer.address, acme.address, amount, nameHash(acmeName), 0n, validBefore, v, r, s], type: 'legacy' }))

  // ---------------------------------------------------------------- 4. hold ends → release
  const p = await pub.readContract({ address: pay, abi: Pay.abi, functionName: 'paymentOf', args: [idGasless] })
  const waitS = Number(p.releaseAt) - Math.floor(Date.now() / 1000) + 5
  if (waitS > 0) {
    console.log(`waiting ${waitS}s for the hold to end…`)
    await sleep(waitS * 1000)
  }
  await tx('Hold over → anyone releases → payee paid, now a known payee', wallet(relayer).writeContract({ address: pay, abi: Pay.abi, functionName: 'release', args: [idGasless], type: 'legacy' }))

  // ---------------------------------------------------------------- 5. known payee: instant
  await tx(`Send 0.5 tUSD8 to known payee "${acmeName}" → delivered instantly`, wallet(deployer).writeContract({ address: pay, abi: Pay.abi, functionName: 'send', args: [newId('instant'), acme.address, usd(0.5), nameHash(acmeName)], type: 'legacy' }))

  // ---------------------------------------------------------------- write results
  const out = {
    chainId: 44005,
    network: 'QDay Aevum Testnet',
    deployedCommit: process.env.SKIP_DEPLOY && prev ? prev.deployedCommit : commit,
    contracts: { VerityDirectory: dir, VerityPay: pay, tUSD8: TUSD8, identityRegistry: IDENTITY_REGISTRY },
    holdSeconds: Number(HOLD_SECONDS),
    demoAccounts: { sender: deployer.address, payee: acme.address, payeeName: acmeName, relayer: relayer.address, lookalike: mallory.address },
    lastDemo: new Date().toISOString(),
  }
  fs.mkdirSync('deployments', { recursive: true })
  fs.writeFileSync('deployments/aevum.json', JSON.stringify(out, null, 2) + '\n')
  const rows = steps.map((x, i) => `| ${i + 1} | ${x.label} | [${x.hash.slice(0, 12)}…](${link(x.hash)}) |`).join('\n')
  const md = `# Verity live demo on QDay Aevum testnet

Run: ${out.lastDemo} · commit \`${commit}\`

| Contract | Address |
|---|---|
| VerityDirectory | [${dir}](${EXPLORER}/address/${dir}) |
| VerityPay | [${pay}](${EXPLORER}/address/${pay}) |
| tUSD8 | [${TUSD8}](${EXPLORER}/address/${TUSD8}) |

Real payee \`${acme.address}\` ("${acmeName}") vs lookalike \`${mallory.address}\`

| # | Step | Transaction |
|---|---|---|
${rows}
`
  fs.writeFileSync('deployments/DEMO.md', md)
  console.log('\n' + md)
  if (!blocked || pr.status === 'success') throw new Error('lookalike payment was not blocked')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
