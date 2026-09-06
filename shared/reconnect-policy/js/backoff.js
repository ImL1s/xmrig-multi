/**
 * Bounded exponential backoff with jitter (#43).
 */

/**
 * @param {object} opts
 * @param {number} opts.attempt zero-based attempt index after a failure
 * @param {number} [opts.baseMs] default 1000
 * @param {number} [opts.factor] default 2
 * @param {number} [opts.maxMs] default 60000
 * @param {number} [opts.jitterRatio] 0..1, default 0.2
 * @param {() => number} [opts.random] inject for tests
 */
export function nextBackoffMs(opts = {}) {
    const attempt = Math.max(0, opts.attempt | 0);
    const base = opts.baseMs ?? 1000;
    const factor = opts.factor ?? 2;
    const maxMs = opts.maxMs ?? 60_000;
    const jitterRatio = opts.jitterRatio ?? 0.2;
    const random = opts.random || Math.random;

    const exp = Math.min(maxMs, base * factor ** attempt);
    const jitter = exp * jitterRatio * (random() * 2 - 1);
    return Math.max(0, Math.round(exp + jitter));
}

/**
 * Effective XMRig retries field for native config.
 * autoReconnect=false → 0 so the engine itself does not loop.
 */
export function nativeRetries(autoReconnect, configuredRetries = 5) {
    if (!autoReconnect) return 0;
    return Math.max(0, configuredRetries | 0);
}
