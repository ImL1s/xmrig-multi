# Reconnect & failover (#43)

Session-owner reconnect policy: classify disconnects, bounded exponential backoff, compatible backup pools, cancel on Stop / thermal / profile change.

| Path | Role |
|------|------|
| `js/classify.js` | Retryable vs fatal disconnect reasons |
| `js/backoff.js` | Exponential backoff + jitter + cap (fake-clock friendly) |
| `js/failover.js` | Ordered backups; payout/protocol/TLS compatibility gates |
| `js/controller.js` | Single owner: decide retry / failover / stop; UI snapshot |
| `test/` | Fake-clock contract tests |

## Rules

- `autoReconnect=false` → no retries after disconnect; phase stays Failed/Stopped.
- Retryable: timeout, DNS, brief network loss, proxy close without auth fail.
- Fatal (no retry): bad wallet, unsupported protocol, TLS cert reject, auth fail, user stop, thermal critical, profile change.
- Failover only among user-approved backups with same payout asset, account, and no TLS downgrade unless backup explicitly allows it.
- Stop / thermal / profile-revision bump cancel pending timers; never restart a stopped session.
- WorkManager / native XMRig / UI must not each invent unbounded retries — call this controller.

## Commands

```bash
node --test shared/reconnect/test/*.test.js
```
