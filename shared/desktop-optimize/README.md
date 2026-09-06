# Desktop advanced optimize controls (#37)

Capability matrix + requested/effective/unsupported status for huge pages, Linux 1GB pages, NUMA, MSR, priority, and yield. Least privilege: never auto-elevate, never rewrite registry/sysctl/BIOS.

| Path | Role |
|------|------|
| `js/matrix.js` | Per-OS capability: available / needs-privilege / unsupported |
| `js/status.js` | Merge requested vs probed → effective + reasons |
| `js/apply.js` | Safe apply plan + rollback notes (no privileged helper by default) |
| `fixtures/` | macOS/Windows/Linux matrices, privilege denied, huge-page fail |
| `test/` | Contract tests |

## Rules

- macOS/Windows must not show enableable Linux-only 1GB pages.
- Privilege denial / allocation failure → conservative fallback + UI reasons.
- MSR changes require explicit consent, original-value record, and restore plan; crash-after-change is **not** guaranteed safe.
- Auto-tuner must not call elevate paths.
- Default priority is normal; never default to realtime/highest.

## Commands

```bash
node --test shared/desktop-optimize/test/*.test.js
```
