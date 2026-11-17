// Winternitz one-time signatures (W=16) over keccak256, matching contracts/src/WOTS.sol.
// Hash-based: secure against quantum computers. Each key signs exactly one message.
import { keccak256, concat, toHex, encodeAbiParameters, hexToBytes } from 'viem'

const LEN = 67
const MAX = 15
const u8 = (n) => toHex(n, { size: 1 })

/** 67 base-16 digits of a 32-byte message: 64 message digits + 3 checksum digits. */
export function digits(m) {
  const b = hexToBytes(m)
  const d = []
  let sum = 0
  for (const byte of b) d.push(byte >> 4, byte & 0xf)
  for (const x of d) sum += MAX - x
  d.push((sum >> 8) & 0xf, (sum >> 4) & 0xf, sum & 0xf)
  return d
}

export function chain(seed, i, from, steps, x) {
  for (let j = from; j < from + steps; j++) x = keccak256(concat([seed, u8(i), u8(j), x]))
  return x
}

/** Secret chain start i of one-time key `k`, derived from the account's master secret. */
export const secret = (master, k, i) =>
  keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }], [master, BigInt(k), BigInt(i)]))

export function keyHash(master, seed, k) {
  const ends = []
  for (let i = 0; i < LEN; i++) ends.push(chain(seed, i, 0, MAX, secret(master, k, i)))
  return keccak256(concat([seed, ...ends]))
}

export function sign(master, seed, k, m) {
  const d = digits(m)
  return d.map((di, i) => chain(seed, i, 0, di, secret(master, k, i)))
}

/** Same check the contract does, for the app to verify locally before submitting. */
export function recover(seed, m, sig) {
  const d = digits(m)
  const ends = sig.map((s, i) => chain(seed, i, d[i], MAX - d[i], s))
  return keccak256(concat([seed, ...ends]))
}
