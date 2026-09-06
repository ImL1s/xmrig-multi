/**
 * Thermal policy defaults (#38).
 * Battery and CPU thresholds are separate — never one "45°C for all hardware".
 */

export const DEFAULTS = Object.freeze({
    /** Soft throttle when battery temp reaches this (°C). */
    batterySoftC: 42,
    /** Pause mining when battery temp reaches this (°C). */
    batteryPauseC: 45,
    /** Critical stop — cannot be disabled by user. */
    batteryCriticalC: 50,
    /** Resume only after cooling below this (°C). */
    batteryResumeC: 40,

    cpuSoftC: 80,
    cpuPauseC: 90,
    cpuCriticalC: 95,
    cpuResumeC: 75,

    /** Minimum time in throttle/pause before evaluating resume (ms). */
    minHoldMs: 30_000,
    /** Extra cooldown after dropping below resume threshold (ms). */
    cooldownMs: 60_000,
    /** Observations older than this are stale. */
    staleAfterMs: 120_000,
    /** Soft-throttle thread factor (temporary; does not rewrite permanent profile). */
    softThrottleFactor: 0.5,
    /** Whether auto-resume after cooldown is allowed (still blocked by userStopped). */
    allowResumeAfterCooldown: true
});

/** OS thermal status ranks — higher is worse. */
export const OS_STATUS_RANK = Object.freeze({
    none: 0,
    light: 1,
    moderate: 2,
    severe: 3,
    critical: 4,
    emergency: 5,
    shutdown: 6
});
