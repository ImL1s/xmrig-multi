# Desktop idle / convenience policy (#77)

Maps OS idle/power/session events to Mining / Paused / Waiting / Stopped with
honest engine capability (XMRig `pause-on-active` / `pause-on-battery`). Does
**not** invent Linux native `pause-on-active`, keylogging, or default
close-to-tray mining.

| Path | Role |
|------|------|
| `js/matrix.js` | Per-OS capability: pause-on-active, pause-on-battery, idle timer |
| `js/engine.js` | Safe XMRig argv from prefs + capability |
| `js/policy.js` | Reducer over fake/real events (Stop latch, idle, AC, sleep) |
| `js/close.js` | First-close prompt; never default hide-and-mine |
| `test/` | Contract tests with fake events |

## Priority (highest first)

1. User Stop / revoke latch
2. Sleep / lid (default respect — no keep-awake without consent)
3. Battery / unplugged when pause-on-battery armed
4. Active user (pause-on-active or app-layer idle timer)
5. Idle timer / schedule (only when idle timestamp is reliable)
6. Autostart / resume-last (separate explicit opt-ins)

## Rules

- Unsupported idle detection → `Unavailable` + manual pause; never assume idle.
- App-layer pause must not fight engine auto-resume (single coordinator).
- Login autostart ≠ resume previous mining session (two checkboxes).
- Wake re-checks power/thermal/budget; Stop stays latched.
- Sleep intervals must not be billed as mining kWh (#70).

## Commands

```bash
node --test shared/desktop-idle-policy/test/*.test.js
```
