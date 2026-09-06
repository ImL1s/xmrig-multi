# Diagnostics UX (#55)

Actionable error codes, bounded searchable logs, de-identified diagnostic packs, and session history summaries. Builds on session-state (#48); does not invent a parallel state machine.

| Path | Role |
|------|------|
| `js/errors.js` | Deterministic code → severity / reason / actions |
| `js/ring-buffer.js` | Bounded in-memory log with filter/search |
| `js/redact.js` | Mask wallet / token / password / seed / URI creds |
| `js/pack.js` | Preview + export diagnostic pack (no auto-upload) |
| `js/session-history.js` | Bounded session start/stop reason history |
| `fixtures/` | Secret-laden logs, unknown errors |
| `test/` | Mapping, redaction fuzz, ring capacity |

## Rules

- Unknown codes keep raw text but never hide the primary fix action when mapped.
- Wallet / spend key / seed / API token / password / URI userinfo never enter ordinary packs.
- No automatic upload or public issue creation.
- Ring buffer + session history are capacity-capped; disk-full → drop oldest safely.

## Commands

```bash
node --test shared/diagnostics/test/*.test.js
```
