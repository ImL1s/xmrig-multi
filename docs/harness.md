# Verification harness (issue #64)

Cross-platform evidence store. Start with offline, reproducible gates from P0.

## Current slices

| Slice | Command | Covers |
|-------|---------|--------|
| Web compact-target / share gate | `cd web && npm test` | #25 regressions, properties, #26/#29 gates, mock Stratum accept/reject |
| MiningProfile contract | `node --test shared/mining-profile/test/*.test.js` | #30 schema/migrate/compile golden fixtures |
| Pool registry | `node --test shared/pool-registry/test/*.test.js` | #40/#41 shared registry + Android/desktop drift |
| Session state machine | `node --test shared/session-state/test/*.test.js` | #48 phase transitions / process-exit unlock |
| Hardware capability | `node --test shared/hardware-capability/test/*.test.js` | #33 snapshot schema / fixtures / recommend / redact |
| RandomX memory budget | `node --test shared/randomx-memory/test/*.test.js` | #35 |
| Auto-tune | `node --test shared/auto-tune/test/*.test.js` | #34 |
| Wallet address | `node --test shared/wallet-address/test/*.test.js` | #53 |
| Reconnect / failover | `node --test shared/reconnect/test/*.test.js` | #43 |
| Daemon endpoint | `node --test shared/daemon-endpoint/test/*.test.js` | #44 |
| Fee manifest | `node --test shared/fee-manifest/test/*.test.js` | #63 |
| Session runtime | `node --test shared/session-runtime/test/*.test.js` | #49 |
| Pool recommend | `node --test shared/pool-recommend/test/*.test.js` | #42 |
| P2Pool connect | `node --test shared/p2pool-connect/test/*.test.js` | #45 |
| Desktop optimize | `node --test shared/desktop-optimize/test/*.test.js` | #37 |
| CPU topology | `node --test shared/cpu-topology/test/*.test.js` | #36 |
| Thermal policy | `node --test shared/thermal-policy/test/*.test.js` | #38 |
| Power policy | `node --test shared/power-policy/test/*.test.js` | #39 |
| Diagnostics | `node --test shared/diagnostics/test/*.test.js` | #55 |
| Release capability | `node --test shared/release-capability/test/*.test.js` | #64 manifest gate |
| GPU capability | `node --test shared/gpu-capability/test/*.test.js` | #65 phase-1 visibility |
| Web proxy setup | `cd web && npm test` (proxy-config tests) | #50 no implicit localhost on public HTTPS |
| Web WASM preflight | `cd web && npm test` (runtime-preflight tests) | #51 COI/SAB/WASM gates + seed validation |
| Android profile mapper | `./gradlew testDebugUnitTest --tests "*MiningProfileMapper*"` | #30 MiningConfig ↔ MiningProfile field mapping |
| Android hardware probe | `./gradlew testDebugUnitTest --tests "*HardwareSnapshot*"` | #33 null-unknown + ABI gate |
| Android native capabilities | `./gradlew testDebugUnitTest --tests "*XmrigNativeCapabilities*"` | TLS + coin start gates |

## Evidence rules

- Public CI must not mine on public pools or embed user wallets.
- `supported` requires fixture + command listed here; UI presence alone is insufficient.
- Packaged OpenCL/CUDA are **off**; release-capability CI fails if a platform claims GPU `supported`.
- Live accepted-share proofs stay out of CI; attach de-identified notes to the issue when done.

## Not yet covered

- Official RandomX known-answer vectors end-to-end in WASM (#25 remainder)
- Artifact smoke for APK / installers / iOS `.a`
- OEM overnight / thermal-power device matrix (#61)
- GPU backend selftest + optional CUDA/OpenCL enable (#65 phase 2)
- Companion sync contract (#62)
