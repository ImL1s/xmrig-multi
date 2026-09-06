# RandomX memory budget (#35)

Honest estimator for RandomX / RandomWOW memory — separates **scratchpad**, **cache**, **dataset**, app reserve, and NUMA duplication. Never treats “2 MB scratchpad” as full-mode RAM.

| Path | Role |
|------|------|
| `js/constants.js` | Algorithm memory constants (MiB) |
| `js/estimate.js` | Budget breakdown + confidence |
| `js/select.js` | Safe auto / manual fast·light selection |
| `js/labels.js` | UI copy that names each memory component |
| `fixtures/` | Low-RAM, NUMA, unknown-memory, allocation-fail cases |
| `test/` | Node contract tests |

## Rules

- Auto picks the safest mode that fits soft budget; manual fast/light is blocked when clearly impossible.
- Soft budget override requires `confirmSoftOverride: true` — never bypass OS hard limits.
- Probe success ≠ allocation success; callers must report actual mode after init.
- Manual permanent locks are not overwritten by auto fallback (see `select.js` `locked`).

## Commands

```bash
node --test shared/randomx-memory/test/*.test.js
```

Official refs: https://xmrig.com/docs/miner/randomx-optimization-guide · https://xmrig.com/docs/algorithms
