/**
 * Bounded exponential backoff with optional jitter (#43).
 * Pure functions — pass `now` / `random` for fake-clock tests.
 */

/**
 * @param {object} [opts]
 * @param {number} [opts.attempt] zero-based attempt index after a failure
 * @param {number} [opts.baseMs] first delay (default 1000)
 * @param {number} [opts.factor] exponential factor (default 2)
 * @param {number} [opts.maxMs] hard cap (default 60000)
 * @param {number} [opts.jitterRatio] 0..1 fraction of delay randomized (default 0.2)
 * @param {() => number} [opts.random] returns 0..1
 * @returns {{ delayMs: number, capped: boolean }}
 */
export function nextBackoff(opts = {}) {
    const attempt = Math.max(0, opts.attempt | 0);
    const baseMs = opts.baseMs ?? 1000;
    const factor = opts.factor ?? 2;
    const maxMs = opts.maxMs ?? 60_000;
    const jitterRatio = opts.jitterRatio ?? 0.2;
    const random = opts.random || Math.random;

    const raw = baseMs * Math.pow(factor, attempt);
    const capped = raw >= maxMs;
    const base = Math.min(raw, maxMs);
    const jitter = base * jitterRatio * random();
    // Spread ±jitter/2 around base without going below base*(1-jitterRatio)
    const delayMs = Math.max(0, Math.round(base - (base * jitterRatio) / 2 + jitter));
    return { delayMs: Math.min(delayMs, maxMs), capped };
}

/**
 * @param {object} policy
 * @param {boolean} policy.autoReconnect
 * @param {number} [policy.maxAttempts] default from retries field
 * @param {number} attemptCount failures so far in this reconnect storm
 */
export function canAttempt(policy, attemptCount) {
    if (!policy || policy.autoReconnect === false) return false;
    const max = policy.maxAttempts ?? policy.retries ?? 5;
    if (max <= 0) return false;
    return attemptCount < max;
}
