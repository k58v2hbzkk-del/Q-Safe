# QSafe live demo on QDay Aevum testnet

Run: 2026-11-17T23:51:11.502Z · commit `cbb443fdaf3dfb90633dceb80ac654d1ac8da691`

| Contract | Address |
|---|---|
| QSafe | [0xc25762b7faf8a5ca3063286f441a51762240e1f7](https://explorer-test.qday.info/address/0xc25762b7faf8a5ca3063286f441a51762240e1f7) |
| tUSD8 | [0x456569838f1d43009A91ebA4263147Afd7233483](https://explorer-test.qday.info/address/0x456569838f1d43009A91ebA4263147Afd7233483) |

Alice's account `0x3ab4f020488d6307e2137e1e9dc297d16d3ea5505dc6e4351c00f2c1c044cca3` · Shop's account `0x2a5e28d28934e299c25538ec0526fee082b4f45a61b6c640b579f27099705223`

| # | Step | Gas | Transaction |
|---|---|---|---|
| 1 | Deploy QSafe | 722609 | [0x2fad947cbe…](https://explorer-test.qday.info/tx/0x2fad947cbe400333c44fb55d6b4fd26fc726a59705d8d9929894d18d179814d6) |
| 2 | Fund the gasless relayer with tQDAY | 21000 | [0x5cf43be51a…](https://explorer-test.qday.info/tx/0x5cf43be51a11ba0096dad94800b0a756021bfc11a0063e4299343425398a345f) |
| 3 | Alice opens a QSafe account (only a hash-based key can spend from it) | 91394 | [0x1b6618d2b6…](https://explorer-test.qday.info/tx/0x1b6618d2b628161e9e3daa271ed6b26188b5ed077d1fbca0b2837d35fce1763e) |
| 4 | Corner Shop opens a QSafe account (only a hash-based key can spend from it) | 91394 | [0x409db5c5f1…](https://explorer-test.qday.info/tx/0x409db5c5f178f18f49db80cffcdf37db1973e9cb28e215448fdc3df71f030f49) |
| 5 | Gasless deposit: wallet signs, relayer moves 2 tUSD8 into Alice's QSafe | 116368 | [0x568a0b0b60…](https://explorer-test.qday.info/tx/0x568a0b0b6097499c60cf1b225e91215957d85e21b1d73a904621afad95bc65a8) |
| 6 | Alice pays 1 tUSD8 to a shop wallet, signed with a Winternitz (hash-based) signature | 245803 | [0x92f69f2c64…](https://explorer-test.qday.info/tx/0x92f69f2c64d91e7cee6ef15ee297f6f206cd234e9f0b1cee9a34bd9d12bdaabd) |
| 7 | Alice pays 0.5 tUSD8 into the shop's QSafe: the money never leaves quantum protection | 216033 | [0x4e24234222…](https://explorer-test.qday.info/tx/0x4e242342227b97a2bb11e7bbd057a2b37dae4eaf05303c16edefaf03224bf0e7) |
| 8 | Q-Day attack: attacker holding the ECDSA key tries to drain Alice's QSafe | 188919 | [0x2e29cb1763…](https://explorer-test.qday.info/tx/0x2e29cb17638b96b8fad03e939ebc793885bdcddf70a383e61f715964e79a720f) |
| 9 | Replay attack: re-submitting Alice's first (already used) signature | 61827 | [0xc7c1e3b788…](https://explorer-test.qday.info/tx/0xc7c1e3b788108f192785c8d1c8c206f633ce4bbfe5449ea181e54005dda80aa2) |
| 10 | Shop withdraws 0.5 tUSD8 with its own one-time quantum-safe key | 228799 | [0xb44519fd22…](https://explorer-test.qday.info/tx/0xb44519fd22d4ab375f30a60942db47b13c8db7f673fa81f9fc212b3d2de4478b) |

Steps marked as attacks were sent on purpose and **reverted on-chain** (BadSignature): that is the expected result.
