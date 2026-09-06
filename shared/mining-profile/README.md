# MiningProfile contract (#30)

Cross-platform **requested → resolved → effective** settings contract.

| Path | Role |
|------|------|
| `schema/mining-profile.schema.json` | JSON Schema (v1) |
| `js/validate.js` | Validate + migrate legacy shapes |
| `js/compile.js` | Reference `compile(profile, capabilities, hardware, policy)` |
| `fixtures/` | Golden profiles |
| `test/` | Node contract tests |

## Compile priority

1. Safety (engine/coin gates, TLS capability, payout rules)
2. Explicit user locks (`locks.fields`)
3. Accepted tune snapshot
4. Verified presets
5. Conservative fallback

Post-launch fields (`runtime.*`) stay `confidence: unknown` until a session readback — requested is never copied into effective as proven.

## Commands

```bash
node --test shared/mining-profile/test/*.test.js
./gradlew testDebugUnitTest --tests "*MiningProfileMapper*"
```

Android maps legacy `MiningConfig` via `MiningProfileMapper` without rewriting the UI stack in this slice.
