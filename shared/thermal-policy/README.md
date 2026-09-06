# Thermal policy (#38)

Cross-platform thermal observation + hysteresis evaluator.

- Distinguishes battery / CPU / package / OS status / headroom sources.
- Never treats `0°C`, `NaN`, stale, or unsupported headroom as healthy.
- Soft throttle → pause → critical stop with resume threshold, cooldown, and min hold.
- Temporary throttle does **not** rewrite permanent thread/profile settings.
- Manual Stop / user intent always wins over auto-resume after cooling.

## API

```js
import { evaluateThermal, normalizeObservation, DEFAULTS } from './js/evaluate.js';

const decision = evaluateThermal({
  observation: normalizeObservation({ source: 'battery', celsius: 48, timestampMs: now }),
  config: DEFAULTS,
  state: { phase: 'allowed', sinceMs: now, permanentThreads: 4 },
  nowMs: now,
  userStopped: false
});
// decision.phase: allowed | soft_throttle | paused | critical
// decision.permanentProfileUnchanged === true
```

## Platforms

| Platform | Sources |
|----------|---------|
| Android | BatteryManager temp + PowerManager Thermal API when available |
| Apple | `ProcessInfo.thermalState` (+ battery temp if present) |
| Desktop | Trusted OS sensors only; unavailable → conservative unknown |
| Web | Typically unsupported → UI shows unavailable, not 0°C |

Kotlin port: `app/.../service/ThermalPolicy.kt`
