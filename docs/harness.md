# Verification harness (issue #64)

Cross-platform evidence store. Start with offline, reproducible gates from P0.

## Current slices

| Slice | Command | Covers |
|-------|---------|--------|
| Web compact-target / share gate | `cd web && npm test` | #25 regressions, properties, #26/#29 gates, mock Stratum accept/reject |
| Android native capabilities | `./gradlew testDebugUnitTest --tests "*XmrigNativeCapabilities*"` | TLS + coin start gates |

## Evidence rules

- Public CI must not mine on public pools or embed user wallets.
- `supported` requires fixture + command listed here; UI presence alone is insufficient.
- Live accepted-share proofs stay out of CI; attach de-identified notes to the issue when done.

## Not yet covered

- Official RandomX known-answer vectors end-to-end in WASM (#25 remainder)
- Artifact smoke for APK / installers / iOS `.a`
- Thermal / power / multi-device matrix
