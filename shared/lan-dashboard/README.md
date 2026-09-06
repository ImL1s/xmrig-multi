# LAN multi-device dashboard (#80)

Secure pairing + read-only LAN board for old phones/tablets. Default **read-only**;
control is a separate grant. Does **not** expose XMRig HTTP API unauthenticated.

| Path | Role |
|------|------|
| `js/pairing.js` | Short-lived pairing codes, revoke, replay/MITM-safe checks |
| `js/auth.js` | Read-only vs control tokens; Start forbidden for read-only |
| `js/aggregate.js` | Multi-device H/s by algo; shared meter once; wallet/pool dedupe |
| `js/board.js` | Per-card stale/offline/session presentation |
| `test/` | Protocol + aggregation fixtures |

## Rules

- Service off by default; bind user-chosen interface only.
- No seed / spend key / pool password on the board channel.
- QR must not embed long-lived control secrets.
- Offline Stop → undelivered (not "stopped"); old Start cannot revive after Stop.
- Pure clock (#74) works with zero miners.

## Commands

```bash
node --test shared/lan-dashboard/test/*.test.js
```
