# Metering adapters — Shelly / Home Assistant (#81)

Optional wall-meter / HA energy inputs for #70. **Read-only by default** — never
Switch.Set / Toggle / ResetCounters from this module. Manual watts still work
without hardware.

| Path | Role |
|------|------|
| `js/units.js` | W / Wh / mWh normalize; unknown/unavailable |
| `js/shelly.js` | Gen2 Switch/PM1 sample parse (apower, aenergy) |
| `js/homeAssistant.js` | Entity state parse; bearer token capability warning |
| `js/policy.js` | Read-only enforcement; shared meter attribution |
| `fixtures/` | Official-shaped samples |
| `test/` | Contract tests |

## Rules

- Unsupported brands stay `unsupported` — no fake “every smart plug meters”.
- HA token may be broader than GET; UI must disclose; store revocably.
- Do not treat solar / negative tariff as free unlimited mining.
- Shared outlet for two miners → count once (or show shared total, not invented splits).
- Never hard-cut power on budget overage — stop miner via controller.

## Commands

```bash
node --test shared/metering-adapters/test/*.test.js
```
