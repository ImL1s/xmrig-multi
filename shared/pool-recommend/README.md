# Pool recommend (#42)

Deterministic ranking over the canonical pool registry using measured hashrate
affinity, endpoint difficulty hints, and fee/status confidence.

- `estimateShareWait` — CryptoNote-style D/H model with p50/p90 (not a payout promise)
- `recommendPools` — never auto-replaces a user-locked pool; unknown fees ≠ 0%
- `firstShareStatus` — distinguishes auth / no-job / waiting / long-wait

```bash
node --test shared/pool-recommend/test/*.test.js
```
