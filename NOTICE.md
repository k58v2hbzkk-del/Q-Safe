# Notices

Verity reuses code from the [QDay Aevum Starter Kit](https://github.com/qday-io/aevum-starter-kit) (MIT License, Copyright (c) 2026 PQA Labs):

- `contracts/src/mocks/MockUSD8.sol`: local stand-in for tUSD8, used only in tests
- `contracts/test/Signing.sol`: EIP-3009 signing helper for tests
- `contracts/foundry.toml`: Shanghai EVM settings (via-IR added)
- The EIP-3009 `receiveWithAuthorization` checkout pattern that `VerityPay` builds on

Libraries: OpenZeppelin Contracts v5.1.0 (MIT), forge-std (MIT/Apache-2.0), viem (MIT).
