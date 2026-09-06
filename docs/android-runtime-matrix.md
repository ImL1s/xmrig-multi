# Android mining runtime matrix (#61)

Fail-closed policy lives in `MiningRuntimePolicy` + ADR 001.

| Event | Expected | Auto-restart? |
|-------|----------|---------------|
| User Start (app visible) | FGS + notification + worker | n/a |
| App background / screen off | Continues until OS quota/FGS limit | No silent re-arm |
| Lock screen | Same as background | No |
| OS stop worker | Clear Mining UI; show system-limited | No |
| Force-stop | Cleared by OS | No until user opens app + Start |
| Reboot | No mining without new user Start | No |
| App update | Session ends | No |
| Quota exhausted | `system_quota` message + clear UI | Never WorkManager-retry |
| FGS start not allowed | `fgs_start_not_allowed` | Never for automated path |
| Notification denied | `notification_denied` | No |
| User Stop | Latched; plug/schedule cannot revive | No |

## OEM overnight residual

**Unverified** in CI: 8h charge + screen-off runs on ≥2 OEM devices (Samsung / Xiaomi / Pixel / …).
Until those notes are attached to #61, release checklist must list “OEM overnight Android” under unverified.

Emulator / unit coverage: `MiningRuntimePolicyTest`, `MiningWorker` fail-closed on quota/FGS denial.
