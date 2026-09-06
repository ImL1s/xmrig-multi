# RandomX memory budget (#35 / #129)

Honest estimator for RandomX / RandomWOW memory — separates **scratchpad**, **cache**, **dataset**, app reserve, and NUMA duplication. Never treats “2 MB scratchpad” as full-mode RAM.

| Path | Role |
|------|------|
| `js/constants.js` | Algorithm memory constants (MiB); XMRig **v6.21.0** dataset ceil |
| `js/estimate.js` | Budget breakdown + confidence |
| `js/select.js` | Safe auto / manual fast·light selection (OOM retry uses same hard gate) |
| `js/launch.js` | Fake-allocator spy + session OOM retry budget |
| `js/labels.js` | UI copy that names each memory component |
| `fixtures/` | Low-RAM, NUMA, unknown-memory, allocation-fail, WOW cases |
| `test/` | Node contract + #129 regression tests |

## Rules

- Auto picks the safest mode that fits soft budget; manual fast/light is blocked when clearly impossible.
- Soft budget override requires `confirmSoftOverride: true` — never bypass OS hard limits.
- `allocationFailed` light retry **must** pass `evaluateMode` / `fitsHardLimit` — no silent bypass (#129).
- RandomWOW fast-mode dataset is **~2080 MiB** (inherits RandomX_ConfigurationBase); 1 MiB is scratchpad only.
- Probe success ≠ allocation success; callers must report actual mode after init.
- Manual permanent locks are not overwritten by auto fallback (see `select.js` `locked`).
- Blocked selections must not create cache/dataset (see `launch.js` / Android `MemoryLaunchGate`).

## Commands

```bash
node --test shared/randomx-memory/test/*.test.js
```

Official refs: https://xmrig.com/docs/miner/randomx-optimization-guide · https://github.com/xmrig/xmrig/blob/v6.21.0/src/crypto/randomx/randomx.h
