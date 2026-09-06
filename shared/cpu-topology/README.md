# CPU topology candidates & affinity (#36)

Topology-aware scheduling candidates and manual affinity validation over HardwareSnapshot (#33). Does **not** claim P-only / SMT-off is faster; OS auto remains the baseline.

| Path | Role |
|------|------|
| `js/platform.js` | Hard affinity / soft hint / unsupported by OS |
| `js/affinity.js` | Parse / validate / normalize CPU-id lists & multi-word masks |
| `js/candidates.js` | Safe candidate set from allowed CPUs + core groups |
| `js/apply.js` | Map profile → XMRig argv / config; fallback on apply failure |
| `js/recompute.js` | Hotplug / cpuset change: keep profile, emit diff |
| `fixtures/` | Invalid masks, offline CPUs, overflow |
| `test/` | Contract tests against hardware-capability fixtures |

## Rules

- Never invent topology: missing `coreGroups` → only OS-auto / allowed-count candidates.
- Empty affinity, offline ids, duplicates, out-of-range → reject or explain normalize.
- Affinity apply failure → warning + fall back to OS auto; never require root.
- Masks for >64 logical CPUs use CPU-id lists / multi-word hex — not a single 32-bit int.
- Sustained hashrate ranking stays with auto-tune (#34); this module only builds legal candidates.

## Commands

```bash
node --test shared/cpu-topology/test/*.test.js
```
