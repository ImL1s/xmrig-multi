# Acceptance delivery matrix (#133 / epic #122)

Status vocabulary:

| Status | Meaning |
|--------|---------|
| `domain-only` | Helper/policy exists; no user→engine path |
| `integrated` | UI/settings → persist → consumer → effect with tests |
| `unavailable` | Safely blocked / not claimed |
| `not-run` | Code path exists; device/OS matrix not executed here |

| Track | Status | Evidence | Residuals |
|-------|--------|----------|-----------|
| #123 quick auth | integrated | PR #135 | Device OEM intent matrix not-run |
| #124 session latch | integrated | PR #135 | Full service instrumentation not-run |
| #125 soft throttle | integrated | PR #137 | OS CPU load proof not-run |
| #126 charging settings | integrated | PR #137 | 8h FGS soak not-run |
| #127 Dream clock | integrated | PR #138 | Screensaver recording not-run |
| #128 auto-tune honesty | integrated (shared) | PR #139 | Native offline adapter not-run |
| #129 memory hard limit | integrated | PR #140 | Device OOM not-run |
| #130 energy budget | integrated | PR #141 | Shelly/HA/Taipower not-run |
| #131 desktop advanced | integrated | PR #142 | Tauri E2E fake-binary not-run |
| #132 Live Activity stale | integrated | PR #143 | iPhone 90s screenshot not-run |
| #65 GPU | domain-only | shared/gpu-capability | No mining GPU consumer |
| #80 LAN dashboard | domain-only | shared/lan-dashboard | No shipped UI owner |
| #81 metering adapters | domain-only | shared/metering-adapters | Fake meter → #130 path only |
| WOW mining | unavailable | start gates | Needs signer/daemon (#28) |
| DERO mining | unavailable | start gates | Needs daemon adapter (#27) |

CI layers:

- **L1** `quality-gate.yml` + shared contracts + static artifact smoke (explicitly not UI/native proof)
- **L2** Android unit consumer suites (`EnergyBudgetIntegrationTest`, session/auth, etc.)
- **L3/L4** device / installer / accepted-share — marked `not-run` unless a linked report exists
