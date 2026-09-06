# Hardware capability model (#33)

Cross-platform **HardwareSnapshot** facts with per-field `source` / `timestamp` / `confidence` / `unknownReason`.

| Path | Role |
|------|------|
| `schema/hardware-snapshot.schema.json` | JSON Schema (v1) |
| `js/validate.js` | Validate + web-like probe helper |
| `js/recommend.js` | Conservative thread / RandomX hints (not auto-tune) |
| `js/export.js` | De-identified capability report |
| `fixtures/` | Topology / ABI / container / no-wmic cases |
| `test/` | Node contract tests |

## Rules

- Missing memory / temperature / cache → `value: null` + `confidence: unknown` (never fake `0`).
- `evidenceKind: fixture` vs `live` must stay distinct in reports.
- Recommendations must not bind outside `cpu.allowed`.
- Export redacts hostname / MAC / serial by default.

## Commands

```bash
node --test shared/hardware-capability/test/*.test.js
```

Desktop live probe: `get_hardware_snapshot` Tauri command (see `desktop/src-tauri/src/hardware.rs`).
