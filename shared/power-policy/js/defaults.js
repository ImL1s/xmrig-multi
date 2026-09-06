/**
 * Power policy defaults (#39) — conservative mobile-first.
 * Labels must stay adjustable; do not claim a % suits every battery.
 */

export const DEFAULTS = Object.freeze({
    /** Only mine while external power is present (plugged). */
    requireExternalPower: true,
    /** Pause when unplugged (even if SOC high). */
    pauseOnUnplug: true,
    /** Charge to this SOC before allowing mining while plugged (null = off). */
    chargeToPercentBeforeMine: 50,
    /** Pause when SOC below this while not effectively charging. */
    minBatteryPercent: 20,
    /** Resume hysteresis — must climb back to this after minBattery pause. */
    resumeBatteryPercent: 30,
    /** Sustained net discharge while plugged → pause/throttle. */
    pauseOnNetDischargeWhilePlugged: true,
    /** Average current window for net-discharge detection (ms). */
    netDischargeWindowMs: 60_000,
    /** Average mA below this (more negative) counts as net discharge. */
    netDischargeThresholdMa: -50,
    /** Prefer unmetered networks when true. */
    preferUnmetered: false,
    /** Require idle for this long before auto-start (null = off). */
    idleAfterMs: null,
    /** Max continuous mining session (null = unlimited). */
    maxSessionMs: null,
    /**
     * Allow windows as minutes-from-midnight [start, end).
     * Empty = always (subject to other rules). Cross-midnight supported.
     */
    allowWindows: Object.freeze([]),
    /** Soft defaults shown as adjustable product defaults — not universal safety. */
    defaultsAreAdjustable: true
});
