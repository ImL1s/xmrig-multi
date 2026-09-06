# ADR 001: Android long-running mining runtime (#61)

- **Status:** Accepted (implementation in progress)
- **Date:** 2026-09-06
- **Parent:** #24 / #61

## Context

XMRig Multi Android currently mines via two long-lived WorkManager workers
(`MiningWorker` + `MonitorWorker`). `MiningWorker` promotes itself with
`ForegroundInfo` typed as `dataSync`.

Android 15+ limits **dataSync** FGS to a shared ~6h/24h budget for targetSdk 15+.
Android 16 additionally applies **job quota** to long-running Workers even when
foregrounded. Using media/microphone/camera FGS types (or renaming services) to
bypass limits is not acceptable.

Distribution channels differ:

| Channel | On-device mining | Notes |
|---------|-----------------|-------|
| GitHub APK / source | Allowed technically | User-started; honest FGS/notifications |
| Google Play | Remote-management / companion framing only | Do **not** claim Play-publishable on-device miner |

## Decision

1. **User-started mining is the only cold-start path.** Plug-in / schedule /
   reboot must not auto-start without an explicit persisted user intent that is
   still valid, and must not retry-storm when `ForegroundServiceStartNotAllowed`.
2. **WorkManager** coordinates start/stop and recovery; the **native XMRig child**
   is the mining process. Stop cancels workers **and** reaps same-UID miner
   children (#49 / existing `XmrigProcessController`).
3. **Do not rely on `dataSync` for overnight mining.** Treat `dataSync` as a
   transitional declaration. Preferred durable path for GitHub APK:
   - user-visible start → direct FGS with an accurate type (`specialUse` only with
     a truthful subtype + review package, never as a blanket exemption), **or**
   - degrade to “foreground app / user must re-tap Start” when the OS denies
     background start or quota is exhausted.
4. **Notifications** always show real phase + one-tap Stop; UI / notification /
   process alive state must agree (session owner #48/#49).
5. **Battery optimization exemptions** are optional, explained, and never required
   for a usable Start→mine→Stop loop.
6. **Play vs APK** capabilities are separate build/docs gates — Play policy limits
   are not the same as “Android cannot mine.”

## Consequences

- Quota exhaustion / FGS start denial / notification permission denied surface as
  **system-limited** actionable errors — never leave the UI stuck on “Mining”.
- Overnight reliability remains **unverified** until recorded 8h charge+screen-off
  runs on ≥2 OEMs (see issue acceptance).
- Manifest / service-type changes require tests asserting the declared type matches
  the runtime `ForegroundInfo` type.

## References

- https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/long-running
- https://developer.android.com/develop/background-work/services/fgs/timeout
- https://developer.android.com/develop/background-work/services/fgs/service-types
- https://developer.android.com/about/versions/16/behavior-changes-all
