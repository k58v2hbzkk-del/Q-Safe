# Verity live demo on QDay Aevum testnet

Run: 2026-11-17T23:13:12.629Z · commit `9a581b170275e62001e11ac73249f1748d96b0ef`

| Contract | Address |
|---|---|
| VerityDirectory | [0x4cfca7aedab62c0f13a5a2a83716d6bb43bb69ff](https://explorer-test.qday.info/address/0x4cfca7aedab62c0f13a5a2a83716d6bb43bb69ff) |
| VerityPay | [0xdf612b06ced87dc34ac08b86d7566d41ef79fa5e](https://explorer-test.qday.info/address/0xdf612b06ced87dc34ac08b86d7566d41ef79fa5e) |
| tUSD8 | [0x456569838f1d43009A91ebA4263147Afd7233483](https://explorer-test.qday.info/address/0x456569838f1d43009A91ebA4263147Afd7233483) |

Real payee `0x03902ca41d36D78dF7900B0E7393d6FeF49eE8cF` ("acme.studio") vs lookalike `0x032E42C4f4F1D0752960945592f91f04F8bb20CF`

| # | Step | Transaction |
|---|---|---|
| 1 | Deploy VerityDirectory | [0xf97deb4e73…](https://explorer-test.qday.info/tx/0xf97deb4e73239f4eccd63d169e53d59c69bbc2d8ccf5d5f952768270378d82ef) |
| 2 | Deploy VerityPay | [0x3cdfb13d54…](https://explorer-test.qday.info/tx/0x3cdfb13d54e1307fadae12a72a16b9ede132323d699d72094a7bb0d8863787e8) |
| 3 | Fund demo account 0x03902c… with gas | [0xa25faa0c60…](https://explorer-test.qday.info/tx/0xa25faa0c60b166db29a0ec2b4983378cc8e36adf4b292a60fd7e0cdb30cabcd7) |
| 4 | Fund demo account 0x8e80aA… with gas | [0x2ea86f84f4…](https://explorer-test.qday.info/tx/0x2ea86f84f4bacce6bdbc39769c510bdab38e5e5fb800ee494cd3b84d34c690b5) |
| 5 | Payee claims the name "acme.studio" | [0xeed68c6817…](https://explorer-test.qday.info/tx/0xeed68c6817efe47e5822616bb1795cb4a22f7f605c7f60b850f4d45e980fea3c) |
| 6 | Sender approves VerityPay (for non-gasless payments) | [0x9c3c09e79f…](https://explorer-test.qday.info/tx/0x9c3c09e79f28ba15b24bb6ee757971be7e324befa75deaf084fba2d236f75312) |
| 7 | Payment to lookalike 0x032E42C4f4F1D0752960945592f91f04F8bb20CF as "acme.studio" → BLOCKED on-chain (NameMismatch) | [0x67f43fa9e0…](https://explorer-test.qday.info/tx/0x67f43fa9e0d08474188554b2f94b5414dd67f152c0800191a4c59376483c206d) |
| 8 | Send 1 tUSD8 to "acme.studio" (new payee → held 600s) | [0xdf53371e6d…](https://explorer-test.qday.info/tx/0xdf53371e6dd79962948e5116d91c11800094e8a327d3bc171fb3308d643a51c7) |
| 9 | Sender changes their mind → cancel (undo) → refunded | [0x2a71af21e8…](https://explorer-test.qday.info/tx/0x2a71af21e82806717c38117d73eaf6ec88c8504feaacd5ade2e14b20090b628d) |
| 10 | Gasless: sender signs, relayer submits 1 tUSD8 to "acme.studio" (held) | [0xceedb158af…](https://explorer-test.qday.info/tx/0xceedb158af9f114fc18aca539c2adf7bb1d2c308cd6a6bea8496d0c1bb9bb50c) |
| 11 | Hold over → anyone releases → payee paid, now a known payee | [0xbb5a3bf1f9…](https://explorer-test.qday.info/tx/0xbb5a3bf1f923f5e6169306db51b4639aa2b0c03e36cb98de5d0b8ba6cdfbf99e) |
| 12 | Send 0.5 tUSD8 to known payee "acme.studio" → delivered instantly | [0x8a3477795d…](https://explorer-test.qday.info/tx/0x8a3477795d0856134e6740e7f75a3c878bb45fc92b598ce1aa7bcfdba3f4bb32) |
