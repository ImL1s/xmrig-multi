# Electricity tariff calculator (#71)

Manual fixed / progressive / time-of-use marginal cost engine.

## Rules

- Unknown price ≠ 0. Explicit `0` and negative rates are allowed when user-entered.
- Progressive marginal cost = `Bill(base + mining) − Bill(base)` (never “all kWh at top tier”).
- TOU splits energy by local scheme timezone; missing fine grain → labeled estimate, never pick cheapest silently.
- Presets are versioned (`effectiveFrom`); Taipower official presets stay `unverified` until document hash + field audit.

## API

```js
import { billEnergy, marginalCost, FixedTariff, ProgressiveTariff, TouTariff } from './js/tariff.js';
```

Kotlin: `app/.../data/energy/ElectricityTariff.kt`
