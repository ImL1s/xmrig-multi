# Pool registry (#40 / #41)

Canonical versioned pool metadata for Android / iOS / Desktop / Web.

| Path | Role |
|------|------|
| `registry.v1.json` | Source of truth |
| `schema/pool-registry.schema.json` | Contract |
| `js/load.js` | Validate + adapters |
| `scripts/generate-adapters.mjs` | Regenerate `app/.../pools.json` + `generated/` |
| `generated/` | Checked-in adapter snapshots + registry hash |

## Commands

```bash
node --test shared/pool-registry/test/*.test.js
node shared/pool-registry/scripts/generate-adapters.mjs
```

After editing `registry.v1.json`, re-run the generator and commit both the registry and generated outputs. CI fails if `app/src/main/assets/pools.json` drifts.

Custom user endpoints are **not** stored in this registry and must not be overwritten by updates (#40).
