/**
 * Web mining runtime preflight (#51).
 * Detects secure context / COI / SAB / WASM / Worker before claiming Mining.
 */

export const PREFLIGHT_CODES = {
    INSECURE_CONTEXT: 'insecure_context',
    NOT_CROSS_ORIGIN_ISOLATED: 'not_cross_origin_isolated',
    NO_SHARED_ARRAY_BUFFER: 'no_shared_array_buffer',
    NO_WEBASSEMBLY: 'no_webassembly',
    NO_WORKER: 'no_worker',
    SAB_ALLOC_FAILED: 'sab_alloc_failed',
    OK: 'ok'
};

/**
 * @param {object} [env]
 * @param {boolean} [env.isSecureContext]
 * @param {boolean} [env.crossOriginIsolated]
 * @param {typeof SharedArrayBuffer} [env.SharedArrayBuffer]
 * @param {typeof WebAssembly} [env.WebAssembly]
 * @param {typeof Worker} [env.Worker]
 * @param {boolean} [env.tryAllocateSAB]
 */
export function runMiningPreflight(env = {}) {
    const isSecureContext = Object.prototype.hasOwnProperty.call(env, 'isSecureContext')
        ? env.isSecureContext
        : globalThis.isSecureContext;
    const crossOriginIsolated = Object.prototype.hasOwnProperty.call(env, 'crossOriginIsolated')
        ? env.crossOriginIsolated
        : globalThis.crossOriginIsolated;
    const SAB = Object.prototype.hasOwnProperty.call(env, 'SharedArrayBuffer')
        ? env.SharedArrayBuffer
        : globalThis.SharedArrayBuffer;
    const WA = Object.prototype.hasOwnProperty.call(env, 'WebAssembly')
        ? env.WebAssembly
        : globalThis.WebAssembly;
    const WorkerCtor = Object.prototype.hasOwnProperty.call(env, 'Worker')
        ? env.Worker
        : globalThis.Worker;
    const tryAllocate = env.tryAllocateSAB !== false;

    const checks = [];
    const fail = (code, message, actionHints = []) => ({
        ok: false,
        code,
        message,
        actionHints,
        checks
    });

    if (!isSecureContext) {
        checks.push({ id: 'secureContext', ok: false });
        return fail(
            PREFLIGHT_CODES.INSECURE_CONTEXT,
            'Mining requires a secure context (HTTPS or localhost).',
            ['Serve over HTTPS', 'Or open via http://localhost during development']
        );
    }
    checks.push({ id: 'secureContext', ok: true });

    if (!WA) {
        checks.push({ id: 'webAssembly', ok: false });
        return fail(PREFLIGHT_CODES.NO_WEBASSEMBLY, 'WebAssembly is unavailable in this browser.', [
            'Use a modern Chromium / Firefox / Safari build'
        ]);
    }
    checks.push({ id: 'webAssembly', ok: true });

    if (typeof WorkerCtor !== 'function') {
        checks.push({ id: 'worker', ok: false });
        return fail(PREFLIGHT_CODES.NO_WORKER, 'Web Workers are blocked or unavailable.', [
            'Disable extensions that block workers',
            'Avoid restricted iframe sandbox without allow-scripts'
        ]);
    }
    checks.push({ id: 'worker', ok: true });

    if (!crossOriginIsolated) {
        checks.push({ id: 'crossOriginIsolated', ok: false });
        return fail(
            PREFLIGHT_CODES.NOT_CROSS_ORIGIN_ISOLATED,
            'Page is not crossOriginIsolated — SharedArrayBuffer RandomX cache cannot be shared safely.',
            [
                'Serve with Cross-Origin-Opener-Policy: same-origin',
                'Serve with Cross-Origin-Embedder-Policy: require-corp',
                'Do not embed this miner in a third-party iframe without permission policies'
            ]
        );
    }
    checks.push({ id: 'crossOriginIsolated', ok: true });

    if (typeof SAB !== 'function') {
        checks.push({ id: 'sharedArrayBuffer', ok: false });
        return fail(
            PREFLIGHT_CODES.NO_SHARED_ARRAY_BUFFER,
            'SharedArrayBuffer is unavailable.',
            ['Confirm COOP/COEP headers', 'Update the browser']
        );
    }
    checks.push({ id: 'sharedArrayBuffer', ok: true });

    if (tryAllocate) {
        try {
            // Small probe only — not a fake progress meter.
            // eslint-disable-next-line no-new
            new SAB(8);
            checks.push({ id: 'sabAllocate', ok: true });
        } catch (e) {
            checks.push({ id: 'sabAllocate', ok: false });
            return fail(
                PREFLIGHT_CODES.SAB_ALLOC_FAILED,
                `SharedArrayBuffer allocation failed: ${e.message || e}`,
                ['Close other heavy tabs', 'Lower worker threads', 'Retry after freeing memory']
            );
        }
    }

    return {
        ok: true,
        code: PREFLIGHT_CODES.OK,
        message: 'Runtime preflight passed',
        actionHints: [],
        checks,
        limits: {
            note: 'Browser background throttling applies; not equivalent to native miners.',
            crossOriginIsolated: true,
            sharedArrayBuffer: true
        }
    };
}

/**
 * Validate RandomX seed_hash from pool job — never accept literal "default".
 * @param {unknown} seed
 * @returns {{ ok: true, seed: string } | { ok: false, code: string, message: string }}
 */
export function validateSeedHash(seed) {
    if (seed == null || seed === '') {
        return { ok: false, code: 'missing_seed', message: 'Job seed_hash is missing' };
    }
    if (typeof seed !== 'string') {
        return { ok: false, code: 'invalid_seed_type', message: 'seed_hash must be a hex string' };
    }
    const s = seed.trim().toLowerCase();
    if (s === 'default') {
        return { ok: false, code: 'placeholder_seed', message: 'Refusing placeholder seed "default"' };
    }
    if (!/^[0-9a-f]+$/i.test(s) || s.length % 2 !== 0) {
        return { ok: false, code: 'invalid_seed_hex', message: 'seed_hash must be even-length hex' };
    }
    if (s.length !== 64) {
        return { ok: false, code: 'invalid_seed_length', message: `seed_hash must be 32 bytes (64 hex chars), got ${s.length / 2}` };
    }
    return { ok: true, seed: s };
}
