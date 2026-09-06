# Solo daemon endpoint parse + RPC preflight (#44)

Do not treat TCP connect as “ready to mine”. Parse daemon URLs correctly, then probe JSON-RPC.

| Path | Role |
|------|------|
| `js/parse.js` | host:port, IPv4, `[IPv6]:port`, http(s):// schemes → engine form |
| `js/preflight.js` | staged DNS/TCP/TLS/RPC checks with mockable transport |
| `test/` | URI property + mock monerod fixtures |

## Rules

- `http://host:18081` must not become host `http`.
- Illegal port → hard error (no silent fallback to 18081 unless port omitted).
- https without TLS capability → reject (no silent downgrade to http).
- TCP ok but syncing / wrong network / restricted RPC → distinct repair hints.
- userinfo in URI never logged; auth belongs in a separate secret field.
- Phone `127.0.0.1` is the phone itself — only default when user chooses local node.

## Commands

```bash
node --test shared/daemon-endpoint/test/*.test.js
```
