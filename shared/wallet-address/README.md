# Wallet address validation (#53)

Local checksum / network / type validation for Monero (Keccak, not SHA3). WOW/DERO use format gates until official vectors are bundled.

| Path | Role |
|------|------|
| `js/keccak256.js` | Original Keccak-256 |
| `js/cn-base58.js` | Cryptonote Base58 decode |
| `js/validate.js` | `validateWalletAddress` + safe URI paste parse |
| `test/` | Official standard vector + mutation negatives |

Checksum pass does **not** prove address ownership.

```bash
node --test shared/wallet-address/test/*.test.js
```
