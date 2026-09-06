# iOS glance / StandBy / Widget / Live Activity (#78)

Display-only mining summary for StandBy, Lock Screen, home-screen widgets, and
optional Live Activities. **Not** a background mining host or timer-driven CPU
loop. Updates follow WidgetKit / ActivityKit schedules.

| Path | Role |
|------|------|
| `js/matrix.js` | Support matrix (StandBy / families / Live Activity) — no false always-on claims |
| `js/snapshot.js` | App Group snapshot shape, secret redaction, stale/offline classification |
| `js/timeline.js` | Timeline refresh policy (minute-aligned; no per-second reload) |
| `test/` | Contract tests |

## Rules

- Never put seed, spend key, pool password, API token, or full payout address in the share suite.
- Stale / offline / app-terminated / session change must not present old H/s as live.
- Widget / Live Activity taps open App Intents / deep links into authorized flows — no policy bypass.
- Pure clock / official StandBy clock needs no miner capability.

## Commands

```bash
node --test shared/ios-glance/test/*.test.js
```
