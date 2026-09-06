# Daemon endpoint parse + RPC readiness (#44)

Typed monerod endpoint parsing and staged readiness checks. TCP connect alone is **not** "ready to mine".

| Path | Role |
|------|------|
| `js/parse.js` | URI / host:port / IPv6 parser → engine URL (no silent endpoint swap) |
| `js/probe.js` | Staged readiness codes (dns/tcp/tls/rpc/sync/auth) for fixtures |
| `fixtures/` | Mock monerod `get_info` / error responses |
| `test/` | Property + fixture contract tests |

Supported forms: `host:port`, `IPv4`, `[IPv6]:port`, `http://…`, `http://[IPv6]:port/path`.  
`https://` is **rejected** when TLS-to-daemon is unsupported (Android). Userinfo never appears in `engineUrl` / logs.

```bash
node --test shared/daemon-endpoint/test/*.test.js
```
