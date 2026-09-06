# Power / convenience policy (#39)

Cross-platform power + schedule + automation intent evaluator.

Verdicts: `Allowed` | `Waiting` | `Paused` | `UserStopped` | `Unavailable`.

## Distinctions

- `externalPowerPresent` / `powerSource` ≠ `chargingStatus` (plugged @ 80% NOT_CHARGING is still plugged).
- `FULL` without plugged confirmation is not treated as on charger forever.
- Desktop without battery / browser without trusted APIs → `Unavailable` (not fake compliance).
- Manual Stop revision blocks AC/schedule/thermal revival until explicit user Start.
- `pause-until-next-plug` is a separate intent from Stop.

## API

```js
import { evaluatePower, normalizePowerObservation, DEFAULTS } from './js/evaluate.js';

const v = evaluatePower({
  observation,
  config: DEFAULTS,
  intent: { automationArmed: true, userStopRevision: 0, sessionArmedRevision: 0 },
  network: { metered: false, available: true },
  idle: { idleMs: 0 },
  schedule: { windows: [], nowMs, timeZone: 'UTC' },
  session: { startedAtMs: now, elapsedMs: 0 },
  nowMs
});
```

Kotlin port: `app/.../service/PowerPolicy.kt`
