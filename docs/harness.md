# Verification harness (issue #64)

Cross-platform evidence store. Start with offline, reproducible gates from P0.

## Current slices

| Slice | Command | Covers |
|-------|---------|--------|
| Web compact-target / share gate | `cd web && npm test` | #25 regressions, properties, #26/#29 gates, mock Stratum accept/reject |
| MiningProfile contract | `node --test shared/mining-profile/test/*.test.js` | #30 schema/migrate/compile golden fixtures |
| Pool registry | `node --test shared/pool-registry/test/*.test.js` | #40/#41 shared registry + Android/desktop drift |
| Session state machine | `node --test shared/session-state/test/*.test.js` | #48 phase transitions / process-exit unlock |
| Android profile mapper | `./gradlew testDebugUnitTest --tests "*MiningProfileMapper*"` | #30 MiningConfig ↔ MiningProfile field mapping |
| Android native capabilities | `./gradlew testDebugUnitTest --tests "*XmrigNativeCapabilities*"` | TLS + coin start gates |

## Evidence rules

- Public CI must not mine on public pools or embed user wallets.
- `supported` requires fixture + command listed here; UI presence alone is insufficient.
- Live accepted-share proofs stay out of CI; attach de-identified notes to the issue when done.

## Not yet covered

- Official RandomX known-answer vectors end-to-end in WASM (#25 remainder)
- Artifact smoke for APK / installers / iOS `.a`
- Thermal / power / multi-device matrix
