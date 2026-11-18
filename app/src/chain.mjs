// Chain, contract and ABI shared by the server and the browser.
import { defineChain, parseAbi } from 'viem'
import deployment from '../../deployments/aevum.json' with { type: 'json' }

export const aevum = defineChain({
  id: 44005,
  name: 'QDay Aevum Testnet',
  nativeCurrency: { name: 'Test QDAY', symbol: 'tQDAY', decimals: 18 },
  rpcUrls: { default: { http: [(typeof process !== 'undefined' && process.env?.AEVUM_RPC) || 'https://rpc-test.qday.info'] } },
  blockExplorers: { default: { name: 'Aevum Explorer', url: 'https://explorer-test.qday.info' } },
  testnet: true,
})

export const EXPLORER = 'https://explorer-test.qday.info'
export const QSAFE = (typeof process !== 'undefined' && process.env?.QSAFE_ADDRESS) || deployment.contracts.QSafe
export const TUSD8 = deployment.contracts.tUSD8
export const DEMO = deployment.demo
export const ZERO32 = `0x${'0'.repeat(64)}`
export const ZERO = '0x0000000000000000000000000000000000000000'

export const qsafeAbi = parseAbi([
  'function open(bytes32 seed, bytes32 keyHash) returns (bytes32)',
  'function accountIdOf(bytes32 seed, bytes32 firstKeyHash) pure returns (bytes32)',
  'function accountOf(bytes32 accountId) view returns ((bytes32 keyHash, bytes32 seed, uint64 nonce, uint64 createdAt, uint128 balance))',
  'function depositNonce(bytes32 accountId, bytes32 salt) view returns (bytes32)',
  'function depositWithAuthorization(bytes32 accountId, bytes32 salt, address from, uint256 amount, uint256 validAfter, uint256 validBefore, uint8 v, bytes32 r, bytes32 s)',
  'function paymentDigest(bytes32 accountId, uint64 nonce, address to, bytes32 toAccount, uint256 amount, bytes32 nextKeyHash) view returns (bytes32)',
  'function pay(bytes32 accountId, address to, bytes32 toAccount, uint256 amount, bytes32 nextKeyHash, bytes32[67] sig)',
  'event Opened(bytes32 indexed accountId, bytes32 seed, bytes32 keyHash)',
  'event Deposited(bytes32 indexed accountId, address indexed from, uint256 amount)',
  'event Paid(bytes32 indexed accountId, uint64 indexed nonce, address to, bytes32 toAccount, uint256 amount, bytes32 nextKeyHash)',
  'error ZeroValue()',
  'error AccountExists(bytes32 accountId)',
  'error NoAccount(bytes32 accountId)',
  'error BadSignature()',
  'error InsufficientBalance(uint256 balance, uint256 amount)',
])

export const tokenAbi = parseAbi(['function balanceOf(address) view returns (uint256)'])
