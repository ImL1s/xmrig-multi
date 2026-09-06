# P2Pool connect-existing (#45)

Connect to a user-managed local/LAN P2Pool. Does **not** auto-install services.

- Stratum (≈3333) ≠ monerod RPC (≈18081)
- Miner pool JSON always has `daemon: false`
- Fixtures cover syncing / wrong port / offline / bad address

```bash
node --test shared/p2pool-connect/test/*.test.js
```
