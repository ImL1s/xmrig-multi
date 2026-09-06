# Companion sync contract (#62)

Wear OS / watchOS are **companions only** — no on-watch mining.

| Concern | Rule |
|---------|------|
| Sync quality | Every payload carries `live` / `stale` / `offline` + `lastSyncAtMs` + source device/session |
| Offline UI | Must not present last hashrate as live |
| Commands | Envelope: `commandId`, target, profile/session, `expiresAtMs` |
| Ack | Phone replies `accepted` / `rejected` / `completed` / `expired` / `undelivered` |
| Ordering | Newer **Stop** beats older **Start**; idempotent `commandId` |
| Secrets | Wallet / pool password / API tokens never on the watch link |
| Refresh | Low-frequency / on-demand (see `WearStatsPushPolicy`) |

```js
import {
  classifySync,
  buildCommand,
  receiveCommand,
  applyCommandOrder
} from './js/protocol.js';
```

Paired-device matrix remains **unverified** until recorded on real hardware; CI covers the contract only.
