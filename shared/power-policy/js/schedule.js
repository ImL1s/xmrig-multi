/**
 * Schedule windows with cross-midnight support (#39).
 * Fake-clock friendly: pass nowMs + optional minute-of-day override.
 */

/**
 * @param {number} nowMs
 * @param {{startMin:number,endMin:number}[]} windows minutes from midnight local
 * @param {number} [minuteOfDay] test seam — when set, skip Date locale
 * @returns {{ allowed: boolean, reason: string|null, nextEvalAtMs: number|null }}
 */
export function evaluateSchedule(nowMs, windows = [], minuteOfDay = null) {
    if (!windows || windows.length === 0) {
        return { allowed: true, reason: null, nextEvalAtMs: null };
    }

    const mod = minuteOfDay != null
        ? ((minuteOfDay % 1440) + 1440) % 1440
        : minuteOfDayFromMs(nowMs);

    for (const w of windows) {
        if (inWindow(mod, w.startMin, w.endMin)) {
            const minsToEnd = minutesUntilBoundary(mod, w.endMin);
            return {
                allowed: true,
                reason: null,
                nextEvalAtMs: nowMs + minsToEnd * 60_000
            };
        }
    }

    // Find next window start
    let best = null;
    for (const w of windows) {
        const mins = minutesUntilBoundary(mod, w.startMin);
        if (best == null || mins < best) best = mins;
    }
    return {
        allowed: false,
        reason: `Outside allowed schedule (minute-of-day=${mod})`,
        nextEvalAtMs: best == null ? null : nowMs + best * 60_000
    };
}

function minuteOfDayFromMs(nowMs) {
    const d = new Date(nowMs);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** [start, end) — if start > end, window crosses midnight. */
export function inWindow(minuteOfDay, startMin, endMin) {
    const m = ((minuteOfDay % 1440) + 1440) % 1440;
    const s = ((startMin % 1440) + 1440) % 1440;
    const e = ((endMin % 1440) + 1440) % 1440;
    if (s === e) return true; // full day
    if (s < e) return m >= s && m < e;
    return m >= s || m < e;
}

function minutesUntilBoundary(from, boundary) {
    const f = ((from % 1440) + 1440) % 1440;
    const b = ((boundary % 1440) + 1440) % 1440;
    return (b - f + 1440) % 1440 || 1440;
}
