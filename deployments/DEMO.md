# QSafe live demo on QDay Aevum testnet

Run: 2026-11-17T23:48:39.812Z · commit `local`

| Contract | Address |
|---|---|
| QSafe | [0x948b3c65b89df0b4894abe91e6d02fe579834f8f](https://explorer-test.qday.info/address/0x948b3c65b89df0b4894abe91e6d02fe579834f8f) |
| tUSD8 | [0x456569838f1d43009A91ebA4263147Afd7233483](https://explorer-test.qday.info/address/0x456569838f1d43009A91ebA4263147Afd7233483) |

Alice's account `0xc7e0fad5d8d7221ba2b5b703a1f5c83ca825f56e2fc7629e0d4ce20ba540dcdd` · Shop's account `0xaf2267a6b739ae55371a9a596beea3799693f2a4b95591b09e4dee6050eead23`

| # | Step | Gas | Transaction |
|---|---|---|---|
| 1 | Gasless deposit: wallet signs, relayer moves 2 tUSD8 into Alice's QSafe | 78189 | [0x930a1869cd…](https://explorer-test.qday.info/tx/0x930a1869cdc97d78379818adb25234ddd3e431c8d6d4b77cc53534a28efd9a6d) |
| 2 | Alice pays 1 tUSD8 to a shop wallet, signed with a Winternitz (hash-based) signature | 217681 | [0xb25ff514b2…](https://explorer-test.qday.info/tx/0xb25ff514b2279ef296ae4036ccaddea4a8d1896ff721700b907db9d563a66911) |
| 3 | Alice pays 0.5 tUSD8 into the shop's QSafe: the money never leaves quantum protection | 205557 | [0x5e99b60ad6…](https://explorer-test.qday.info/tx/0x5e99b60ad606f1446127734a1b315edd5a3b405d35f148a5a9af3e6b3b8f7bda) |
| 4 | Q-Day attack: attacker holding the ECDSA key tries to drain Alice's QSafe | 191031 | [0x5353c858ae…](https://explorer-test.qday.info/tx/0x5353c858aee51f7b642b2d6450bed2ca189c875bbf4e2edce55a87621b40303c) |
| 5 | Replay attack: re-submitting Alice's first (already used) signature | 191091 | [0x51a6b70066…](https://explorer-test.qday.info/tx/0x51a6b70066bffd33b6d0427a3d842bed860c6ed1ebb2c2e49f9e627145d13a60) |
| 6 | Shop withdraws 0.5 tUSD8 with its own one-time quantum-safe key | 209221 | [0x34dea6b8b2…](https://explorer-test.qday.info/tx/0x34dea6b8b209f691d9059b8c19f8565d4ae81c928a2009c4281e18ee80eb1e11) |

Steps marked as attacks were sent on purpose and **reverted on-chain** (BadSignature): that is the expected result.
