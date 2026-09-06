# Fee transparency manifest (#63)

Machine-readable fee layers so UI/docs/tests do not invent a single “1%” that hides upstream/proxy/pool fees or mismatched binaries.

| Path | Role |
|------|------|
| `manifest.v1.json` | Per-platform layers: developer / upstream / proxy / pool |
| `js/load.js` | Load + validate + summarize for UI |
| `js/time-window.js` | Shared 99/1 minute cycle math (not an account deduction %) |
| `test/` | Consistency vs documented wallet/percent; iOS mismatch flag |

## Rules

- Time-based developer fee ≠ pool fee ≠ payment processor fee.
- Unknown fees must not display as 0%.
- iOS tracked `.a` is upstream donate until rebuilt — manifest must say so.
- Web proxy fee only applies to Monero sessions (XMR fee wallet).
- Adjustable donate sliders must not claim values the engine silently floors.

## Commands

```bash
node --test shared/fee-manifest/test/*.test.js
```
