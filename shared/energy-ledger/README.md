# Energy ledger (#70)

Cross-platform energy samples → kWh ledger with quality/scope tagging.

## Rules

- Never invent `0 W` / `0 kWh` for unknown power — return `unknown` coverage.
- Prefer cumulative meter deltas; integrate W samples only with explicit sampling semantics.
- Scopes are distinct: wall / USB / CPU package / GPU / battery net. Do not double-bill.
- Shared wall meters for multiple miners count once (attribution optional, never fabricated per-device precision).
- Counter reset / new meter epoch / gaps are recorded as unknown coverage, not free energy.
- Baseline modes: `off` | `idle` | `clock` — incremental = device − baseline when both known.

## API

```js
import {
  normalizeSample,
  toWattHours,
  integrateWatts,
  EnergyLedger,
  calibrateIncremental
} from './js/ledger.js';
```

Kotlin port: `app/.../data/energy/EnergyLedger.kt`
