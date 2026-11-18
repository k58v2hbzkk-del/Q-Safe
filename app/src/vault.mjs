// The user's QSafe account, kept on this device. The master secret never leaves the browser:
// the server only ever sees public key commitments and finished one-time signatures.
import { createWalletClient, custom, encodeAbiParameters, keccak256, parseUnits, formatUnits, toHex, getAddress, isAddress } from 'viem'
import { keyHash, sign, recover } from './wots.mjs'
import { aevum, TUSD8, ZERO32, ZERO } from './chain.mjs'

const STORE = 'qsafe.vault.v1'

const api = async (path, body) => {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
  const j = await r.json().catch(() => ({ error: 'Server error' }))
  if (!r.ok) throw new Error(j.error ?? 'Request failed')
  return j
}
const rand32 = () => {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return toHex(b)
}
const idOf = (seed, kh) => keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [seed, kh]))

export const fmt = (raw) => Number(formatUnits(BigInt(raw), 6)).toLocaleString(undefined, { maximumFractionDigits: 2 })

export function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? 'null')
  } catch {
    return null
  }
}
function save(v) {
  try {
    localStorage.setItem(STORE, JSON.stringify(v))
  } catch {
    /* private mode: the vault lives for this tab only */
  }
}

/** Recovery code = master secret + public seed. Whoever has it can spend the account. */
export const recoveryCode = (v) => `qsafe:${v.master.slice(2)}${v.seed.slice(2)}`

export function importCode(code) {
  const m = String(code).trim().match(/^qsafe:([0-9a-f]{64})([0-9a-f]{64})$/i)
  if (!m) throw new Error('That is not a QSafe recovery code.')
  const master = `0x${m[1].toLowerCase()}`
  const seed = `0x${m[2].toLowerCase()}`
  const first = keyHash(master, seed, 0)
  const v = { master, seed, firstKeyHash: first, accountId: idOf(seed, first), pending: null }
  save(v)
  return v
}

/** Create keys on this device and open the account on Aevum (the relayer pays the gas). */
export async function create() {
  const master = rand32()
  const seed = rand32()
  const first = keyHash(master, seed, 0)
  const v = { master, seed, firstKeyHash: first, accountId: idOf(seed, first), pending: null }
  save(v)
  const r = await api('/api/open', { seed, keyHash: first })
  return { vault: v, tx: r }
}

export const account = (v) => api(`/api/account?id=${v.accountId}`)

// ------------------------------------------------------------ deposits from a normal wallet (EIP-3009, gasless)
let wallet = null
export let walletAddress = null
export async function connectWallet() {
  const eth = window.ethereum
  if (!eth) throw new Error('No wallet found. Open this page in your wallet app’s browser (MetaMask, Rabby, OKX…).')
  const [addr] = await eth.request({ method: 'eth_requestAccounts' })
  const chainId = toHex(aevum.id)
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] })
  } catch (e) {
    if (e?.code === 4902 || /Unrecognized|not added|4902/i.test(String(e?.message))) {
      await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId, chainName: aevum.name, nativeCurrency: aevum.nativeCurrency, rpcUrls: aevum.rpcUrls.default.http, blockExplorerUrls: [aevum.blockExplorers.default.url] }] })
    } else throw e
  }
  walletAddress = getAddress(addr)
  wallet = createWalletClient({ account: walletAddress, chain: aevum, transport: custom(eth) })
  return walletAddress
}
export const walletBalance = async () => (walletAddress ? (await api(`/api/wallet?address=${walletAddress}`)).tusd8 : '0')

export async function deposit(v, amount) {
  if (!wallet) await connectWallet()
  const value = parseUnits(String(amount), 6)
  const salt = rand32()
  const { nonce } = await api(`/api/depositNonce?id=${v.accountId}&salt=${salt}`)
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600)
  const sig = await wallet.signTypedData({
    domain: { name: 'tUSD8', version: '2', chainId: aevum.id, verifyingContract: TUSD8 },
    types: { ReceiveWithAuthorization: [
      { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
    ] },
    primaryType: 'ReceiveWithAuthorization',
    message: { from: walletAddress, to: (await api('/api/config')).qsafe, value, validAfter: 0n, validBefore, nonce },
  })
  let vv = parseInt(sig.slice(130, 132), 16)
  if (vv < 27) vv += 27
  return api('/api/deposit', { accountId: v.accountId, salt, from: walletAddress, amount: value.toString(), validAfter: '0', validBefore: validBefore.toString(), v: vv, r: `0x${sig.slice(2, 66)}`, s: `0x${sig.slice(66, 130)}` })
}

// ------------------------------------------------------------ quantum-safe payments
/**
 * Pay from QSafe. Signs with the current one-time key on this device and names the next key.
 * A one-time key must never sign two different messages, so a signed-but-unsent payment is kept
 * and re-sent exactly as it was if anything fails.
 */
export async function pay(v, { to, amount }, onStep = () => {}) {
  const value = parseUnits(String(amount), 6)
  const isAccount = /^0x[0-9a-fA-F]{64}$/.test(String(to).trim())
  if (!isAccount && !isAddress(String(to).trim())) throw new Error('Pay to a 0x address or a QSafe account id.')
  const payee = isAccount ? { to: ZERO, toAccount: String(to).trim().toLowerCase() } : { to: getAddress(String(to).trim()), toAccount: ZERO32 }

  const a = await account(v)
  const k = a.nonce
  let p = v.pending
  if (p && p.nonce !== k) p = v.pending = null // it landed earlier
  if (p && (p.to !== payee.to || p.toAccount !== payee.toAccount || p.amount !== value.toString())) {
    throw new Error('A previous payment was signed but not sent. Send it first (tap Pay again with the same details) to keep your one-time key safe.')
  }
  if (!p && BigInt(a.balance) < value) throw new Error(`Not enough tUSD8. This vault holds ${fmt(a.balance)}.`)
  if (value <= 0n) throw new Error('Enter an amount above zero.')
  if (!p) {
    onStep('Deriving your next one-time key…')
    const next = keyHash(v.master, v.seed, k + 1)
    const { digest } = await api(`/api/digest?id=${v.accountId}&nonce=${k}&to=${payee.to}&toAccount=${payee.toAccount}&amount=${value}&next=${next}`)
    onStep('Signing with 67 hash chains…')
    const sig = sign(v.master, v.seed, k, digest)
    if (recover(v.seed, digest, sig) !== a.keyHash) throw new Error('This device’s keys do not match the account on-chain.')
    p = v.pending = { nonce: k, ...payee, amount: value.toString(), next, sig }
    save(v)
  }
  onStep('Relaying to Aevum…')
  const r = await api('/api/pay', { accountId: v.accountId, to: p.to, toAccount: p.toAccount, amount: p.amount, nextKeyHash: p.next, sig: p.sig })
  v.pending = null
  save(v)
  return { ...r, sig: p.sig, keyIndex: k }
}

export const attack = (kind) => api('/api/attack', { kind })
export const config = () => api('/api/config')
export { save }
