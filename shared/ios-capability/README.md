# iOS engine capability (#60)

Decide JIT / RandomX light / background claims from **binary + signing + distribution channel** evidence — not iOS version strings alone.

| Path | Role |
|------|------|
| `js/resolve.js` | Resolve capability report + effective randomx keys |
| `fixtures/` | sideload / app-store companion / missing binary / unverified |
| `test/` | Contract tests |

## Channels

| Channel | On-device miner | Notes |
|---------|----------------|-------|
| `sideload-miner` | Possible if binary present + selftest | Not App Store distributable |
| `source-build` | Same as sideload when linked | Developer rebuild |
| `app-store-companion` | **Never** claim on-device mining | Glance / remote only |
| `unverified` | Fail closed | Missing hash/selftest |

## Rules

- Config key present ≠ engine accepts it; only report keys proven by integration/selftest.
- Background / lock-screen mining is never promised; show OS limits honestly.
- Unverified device/OS/signing combos stay `unverified`.

## Commands

```bash
node --test shared/ios-capability/test/*.test.js
```
