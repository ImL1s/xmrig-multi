# Auto-tune service (#34)

Measured quiet / power / balanced / max-sustained recommendations over HardwareSnapshot (#33) + RandomX memory budget (#35).

| Path | Role |
|------|------|
| `js/fingerprint.js` | Hardware+engine+algo+policy fingerprint (stale when changed) |
| `js/candidates.js` | Small safe candidate set (threads × memory mode) |
| `js/tuner.js` | Search loop with cancel, locks, cooldown, rollback |
| `js/benchmark.js` | Pluggable benchmark (fake clock for tests; no share/wallet upload) |
| `fixtures/` | Noisy winner, no improvement, timeout, cancel |
| `test/` | Deterministic fake-benchmark contract tests |

## Rules

- Uncalibrated → conservative suggestion + reason; user may skip.
- Locked fields never enter search; results apply only after user accept.
- Abort on thermal/low-battery/memory pressure/user cancel; leave no orphan workers.
- No watts sensor → never claim measured H/W or H/J.
- Fan/noise absent → quiet goal uses load proxy and labels it as proxy.
- Offline benchmark must not send shares, wallet, or hardware to third parties.

## Commands

```bash
node --test shared/auto-tune/test/*.test.js
```
