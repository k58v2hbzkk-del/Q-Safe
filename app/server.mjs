// QSafe web server: serves the site and runs the gasless relayer.
// The relayer can only submit what users signed: QSafe checks every Winternitz signature and
// every EIP-3009 authorization on-chain. Requests are simulated first, rate-limited and capped.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createPublicClient, createWalletClient, http as rpc, isAddress, isHex, getAddress, keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { aevum, QSAFE, TUSD8, DEMO, EXPLORER, ZERO32, ZERO, qsafeAbi, tokenAbi } from './src/chain.mjs'

const PORT = Number(process.env.PORT ?? 3000)
const ROOT = import.meta.dirname
const STATIC = [path.join(ROOT, 'dist'), path.join(ROOT, 'public')]
const PER_IP_HOUR = Number(process.env.MAX_PER_IP_HOUR ?? 30)
const PER_DAY = Number(process.env.MAX_PER_DAY ?? 500)

const pub = createPublicClient({ chain: aevum, transport: rpc() })
const key = process.env.RELAYER_KEY?.trim()
const relayer = key ? privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`) : null
const wallet = relayer ? createWalletClient({ account: relayer, chain: aevum, transport: rpc() }) : null

// ------------------------------------------------------------ limits
const hits = new Map()
let day = ''
let today = 0
function limit(ip) {
  const d = new Date().toISOString().slice(0, 10)
  if (d !== day) (day = d), (today = 0)
  if (today >= PER_DAY) return 'The relayer hit its daily limit. Try again tomorrow.'
  const now = Date.now()
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000)
  if (list.length >= PER_IP_HOUR) return 'Too many requests from your network. Try again later.'
  list.push(now)
  hits.set(ip, list)
  today++
  return null
}

const b32 = (x) => isHex(x) && x.length === 66
const friendly = (e) => {
  const m = `${e?.shortMessage ?? ''} ${e?.message ?? e}`
  if (/BadSignature/.test(m)) return 'Rejected: the quantum-safe signature does not match this account.'
  if (/InsufficientBalance/.test(m)) return 'Not enough tUSD8 in this QSafe account.'
  if (/NoAccount/.test(m)) return 'That QSafe account does not exist.'
  if (/AccountExists/.test(m)) return 'This account is already open.'
  if (/authorization|signature|FiatToken/i.test(m)) return 'The wallet signature was not accepted. Please sign again.'
  if (/exceeds balance|insufficient/i.test(m)) return 'Not enough tUSD8 in your wallet.'
  return String(e?.shortMessage ?? e?.message ?? e).split('\n')[0].slice(0, 200)
}

async function relay(functionName, args) {
  if (!wallet) throw new Error('The relayer is not configured on this server.')
  const { request } = await pub.simulateContract({ account: relayer, address: QSAFE, abi: qsafeAbi, functionName, args })
  const hash = await wallet.writeContract({ ...request, type: 'legacy' })
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 })
  if (r.status !== 'success') throw new Error('Transaction failed on-chain.')
  return { hash, explorer: `${EXPLORER}/tx/${hash}`, gasUsed: r.gasUsed.toString() }
}

const routes = {
  'GET /api/config': async () => ({ chainId: aevum.id, explorer: EXPLORER, qsafe: QSAFE, token: TUSD8, demo: DEMO, relayer: relayer?.address ?? null }),

  // The live demo record, read from deployments/DEMO.md (written by scripts/live-demo.mjs).
  'GET /api/proof': async () => {
    const md = fs.readFileSync(path.join(ROOT, '..', 'deployments', 'DEMO.md'), 'utf8')
    const rows = [...md.matchAll(/^\| (\d+) \| (.+?) \| (\d+) \| \[[^\]]+\]\((https:[^)]+)\) \|$/gm)]
    return { qsafe: QSAFE, token: TUSD8, explorer: EXPLORER, txs: rows.map((r) => ({ step: r[2], gas: Number(r[3]), url: r[4], attack: /attack/i.test(r[2]) })) }
  },

  'GET /api/account': async (_, __, url) => {
    const id = url.searchParams.get('id')
    if (!b32(id)) throw new Error('Bad account id.')
    const a = await pub.readContract({ address: QSAFE, abi: qsafeAbi, functionName: 'accountOf', args: [id] })
    return { exists: a.keyHash !== ZERO32, keyHash: a.keyHash, seed: a.seed, nonce: Number(a.nonce), createdAt: Number(a.createdAt), balance: a.balance.toString() }
  },

  'GET /api/wallet': async (_, __, url) => {
    const a = url.searchParams.get('address')
    if (!isAddress(a)) throw new Error('Bad address.')
    return { tusd8: (await pub.readContract({ address: TUSD8, abi: tokenAbi, functionName: 'balanceOf', args: [a] })).toString() }
  },

  'GET /api/digest': async (_, __, url) => {
    const q = Object.fromEntries(url.searchParams)
    if (!b32(q.id) || !b32(q.next) || !b32(q.toAccount ?? ZERO32)) throw new Error('Bad request.')
    const to = q.to && isAddress(q.to) ? getAddress(q.to) : ZERO
    const m = await pub.readContract({ address: QSAFE, abi: qsafeAbi, functionName: 'paymentDigest', args: [q.id, BigInt(q.nonce), to, q.toAccount ?? ZERO32, BigInt(q.amount), q.next] })
    return { digest: m }
  },

  'GET /api/depositNonce': async (_, __, url) => {
    const id = url.searchParams.get('id')
    const salt = url.searchParams.get('salt')
    if (!b32(id) || !b32(salt)) throw new Error('Bad request.')
    return { nonce: await pub.readContract({ address: QSAFE, abi: qsafeAbi, functionName: 'depositNonce', args: [id, salt] }) }
  },

  'POST /api/open': async (b, ip) => {
    if (!b32(b.seed) || !b32(b.keyHash)) throw new Error('Bad request.')
    const l = limit(ip)
    if (l) throw new Error(l)
    return relay('open', [b.seed, b.keyHash])
  },

  'POST /api/deposit': async (b, ip) => {
    const { accountId, salt, from, amount, validAfter, validBefore, v, r, s } = b
    if (![accountId, salt, r, s].every(b32) || !isAddress(from)) throw new Error('Bad request.')
    const amt = BigInt(amount)
    if (amt <= 0n || amt > 1_000_000_000n) throw new Error('Deposit between 0 and 1,000 tUSD8.')
    const l = limit(ip)
    if (l) throw new Error(l)
    return relay('depositWithAuthorization', [accountId, salt, getAddress(from), amt, BigInt(validAfter), BigInt(validBefore), Number(v), r, s])
  },

  'POST /api/pay': async (b, ip) => {
    const { accountId, to, toAccount, amount, nextKeyHash, sig } = b
    if (!b32(accountId) || !b32(nextKeyHash) || !b32(toAccount ?? ZERO32)) throw new Error('Bad request.')
    if (!Array.isArray(sig) || sig.length !== 67 || !sig.every(b32)) throw new Error('A QSafe signature has 67 parts.')
    const payee = to && isAddress(to) ? getAddress(to) : ZERO
    const l = limit(ip)
    if (l) throw new Error(l)
    return relay('pay', [accountId, payee, toAccount ?? ZERO32, BigInt(amount), nextKeyHash, sig])
  },

  // Try to rob the live demo account with a forged signature. Simulated only: no gas, no state change.
  'POST /api/attack': async (b) => {
    const kind = b.kind === 'replay' ? 'replay' : 'forge'
    const target = DEMO.aliceAccount
    const a = await pub.readContract({ address: QSAFE, abi: qsafeAbi, functionName: 'accountOf', args: [target] })
    const sig = Array.from({ length: 67 }, (_, i) => keccak256(toBytes(`attacker-${kind}-${i}-${Date.now()}`)))
    const thief = '0x000000000000000000000000000000000000dEaD'
    try {
      await pub.simulateContract({ account: thief, address: QSAFE, abi: qsafeAbi, functionName: 'pay', args: [target, thief, ZERO32, a.balance > 0n ? a.balance : 1n, keccak256(toBytes('thief-key')), sig] })
      return { blocked: false, message: 'Unexpected: the attack passed.' }
    } catch (e) {
      return { blocked: true, balance: a.balance.toString(), reason: /BadSignature/.test(String(e?.message)) ? 'BadSignature' : 'Reverted', message: 'Blocked by QSafe on Aevum: the signature is not a valid hash-based signature for this account.' }
    }
  },
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.jpg': 'image/jpeg' }
function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
  for (const dir of STATIC) {
    const f = path.join(dir, rel)
    if (!f.startsWith(dir)) continue
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const size = fs.statSync(f).size
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '')
      if (range && path.extname(f) === '.mp4') {
        const start = range[1] ? Number(range[1]) : 0
        const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
        res.writeHead(206, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 })
        return fs.createReadStream(f, { start, end }).pipe(res)
      }
      res.writeHead(200, { 'content-length': size, 'accept-ranges': 'bytes', 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream', 'cache-control': 'public, max-age=600' })
      return fs.createReadStream(f).pipe(res)
    }
  }
  res.writeHead(200, { 'content-type': TYPES['.html'] })
  fs.createReadStream(path.join(ROOT, 'public', 'index.html')).pipe(res)
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/health') return void res.end('ok')
    const route = routes[`${req.method} ${url.pathname}`]
    if (!route) return serveStatic(req, res, url.pathname)
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim()
    try {
      let body = {}
      if (req.method === 'POST') {
        let raw = ''
        for await (const c of req) if ((raw += c).length > 50_000) throw new Error('Request too large.')
        body = raw ? JSON.parse(raw) : {}
      }
      const out = await route(body, ip, url)
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(out, (_, v) => (typeof v === 'bigint' ? v.toString() : v)))
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: friendly(e) }))
    }
  })
  .listen(PORT, () => console.log(`QSafe on :${PORT} · relayer ${relayer?.address ?? 'OFF'}`))
