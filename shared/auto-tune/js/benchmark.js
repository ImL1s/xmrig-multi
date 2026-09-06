/**
 * Pluggable offline benchmark for auto-tune (#34).
 * Fake harness is deterministic; live adapters must not upload wallet/shares.
 */

/**
 * @typedef {object} BenchSample
 * @property {number} hashrate
 * @property {number} [watts]
 * @property {number} [loadProxy]
 * @property {boolean} [thermalThrottle]
 * @property {string} [note]
 */

/**
 * @typedef {object} BenchResult
 * @property {boolean} ok
 * @property {number} hashrate
 * @property {number|null} watts
 * @property {number|null} hashesPerJoule
 * @property {number} loadProxy
 * @property {boolean} thermalThrottle
 * @property {string} confidence
 * @property {string[]} notes
 * @property {boolean} timedOut
 * @property {boolean} cancelled
 */

/**
 * Deterministic fake benchmark for tests.
 * @param {object} candidate
 * @param {object} ctx
 * @param {{ seed?: number, noise?: number, map?: Record<string, BenchSample>, failIds?: string[], slowIds?: string[], durationMs?: number, now?: () => number, abortSignal?: { aborted: boolean } }} ctx
 * @returns {Promise<BenchResult>}
 */
export async function fakeBenchmark(candidate, ctx = {}) {
    const notes = [];
    if (ctx.abortSignal?.aborted) {
        return emptyResult(true, true, ['cancelled before start']);
    }
    const duration = ctx.durationMs ?? 5;
    const start = (ctx.now || Date.now)();
    // Simulate work slice without real mining
    await sleep(0);
    if (ctx.abortSignal?.aborted) {
        return emptyResult(true, false, ['cancelled during warmup']);
    }
    if ((ctx.slowIds || []).includes(candidate.id)) {
        notes.push('simulated timeout');
        return {
            ...emptyResult(false, true, notes),
            timedOut: true,
            confidence: 'low'
        };
    }
    if ((ctx.failIds || []).includes(candidate.id)) {
        return emptyResult(false, false, ['candidate failed']);
    }
    const mapped = ctx.map?.[candidate.id];
    let hashrate = mapped?.hashrate;
    if (hashrate == null) {
        // Stable synthetic: threads * modeFactor * (1 + tiny seed noise)
        const modeFactor = candidate.randomxMode === 'fast' ? 1.0 : 0.55;
        const seed = ctx.seed ?? 1;
        const noise = (ctx.noise ?? 0) * pseudoNoise(candidate.id, seed);
        hashrate = candidate.threads * 100 * modeFactor * (1 + noise);
    }
    const watts = mapped?.watts ?? null;
    const loadProxy = mapped?.loadProxy ?? candidate.threads;
    const thermalThrottle = Boolean(mapped?.thermalThrottle);
    if (mapped?.note) notes.push(mapped.note);
    if (watts == null) notes.push('no watts sensor — H/J not claimed');
    const elapsed = (ctx.now || Date.now)() - start;
    if (duration > 0 && elapsed > duration * 100 && ctx.enforceWallClock) {
        return { ...emptyResult(false, true, ['wall clock timeout']), timedOut: true };
    }
    return {
        ok: true,
        hashrate,
        watts,
        hashesPerJoule: watts != null && watts > 0 ? hashrate / watts : null,
        loadProxy,
        thermalThrottle,
        confidence: watts != null ? 'medium' : 'low',
        notes,
        timedOut: false,
        cancelled: false
    };
}

function emptyResult(cancelled, timedOut, notes) {
    return {
        ok: false,
        hashrate: 0,
        watts: null,
        hashesPerJoule: null,
        loadProxy: 0,
        thermalThrottle: false,
        confidence: 'unknown',
        notes,
        timedOut: Boolean(timedOut),
        cancelled: Boolean(cancelled)
    };
}

function pseudoNoise(id, seed) {
    let h = seed | 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return ((h % 1000) / 1000 - 0.5) * 0.02;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
