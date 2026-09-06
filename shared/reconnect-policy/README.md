# Reconnect policy (#43)

Single session-owner policy for transient disconnect vs permanent failure vs user/policy stop.

| Path | Role |
|------|------|
| `js/classify.js` | Retryable vs fatal error classification |
| `js/backoff.js` | Exponential backoff + jitter (bounded) |
| `js/decide.js` | `autoReconnect=false` / cancel / stop / thermal → no retry |
| `js/failover.js` | Compatible backup endpoint gate (same payout coin/wallet/TLS policy) |
| `fixtures/` | DNS blip, auth fail, TLS cert, all-backups-exhausted |
| `test/` | Fake-clock bounded retries; no reconnect storm |

## Rules

- `autoReconnect=false` → never schedule retry; XMRig `retries` must be 0.
- User Stop / thermal critical / profile change → cancel pending retries.
- Failover never changes wallet, payout coin, or TLS-downgrade without approval.
- One owner coordinates native retries — UI/WorkManager must not each storm.

```bash
node --test shared/reconnect-policy/test/*.test.js
```
