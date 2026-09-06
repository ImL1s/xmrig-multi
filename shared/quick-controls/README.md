# Quick controls command interface (#79)

Versioned, revocable commands for Android Tile / Widget / notification actions
and optional paired external automation. **Not** a second miner controller.

| Path | Role |
|------|------|
| `js/commands.js` | Whitelist ops, commandId, deadline, session, Stop>Start order, ack |
| `js/snapshot.js` | Read-only status snapshot for tiles/widgets |
| `test/` | Contract tests |

## Rules

- Whitelist only: `start_profile`, `stop_mining`, `pause_for`, `disable_automation`, `open_clock`.
- No wallet / argv / shell / pool password in commands.
- Expired / unauthorized / session mismatch → `rejected` or `expired` (never fake started).
- Newer Stop always beats older Start; pause expiry cannot revive after Stop.
- Tile/Widget callbacks must only enqueue — no RandomX init in the callback.

## Commands

```bash
node --test shared/quick-controls/test/*.test.js
```
