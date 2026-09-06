/**
 * Staged apply for advanced mining controls (#57).
 */

/** @typedef {'hot'|'restart'|'unsupported'} ApplyMode */
/** @typedef {'default'|'user'|'tuner'|'lock'|'policy'} ValueSource */

/**
 * Engine-backed field catalog. Unsupported fields must not be shown as free controls.
 */
export const FIELD_CATALOG = Object.freeze({
    threads: {
        applyMode: 'restart',
        source: 'user',
        min: 1,
        maxKey: 'cpuThreads',
        defaultFrom: 'recommendThreads'
    },
    maxCpuUsage: {
        applyMode: 'restart',
        source: 'user',
        min: 1,
        max: 100
    },
    workerName: {
        applyMode: 'restart',
        source: 'user'
    },
    poolUrl: {
        applyMode: 'restart',
        source: 'user',
        sensitive: false
    },
    walletAddress: {
        applyMode: 'restart',
        source: 'user',
        sensitive: true
    },
    useTls: {
        applyMode: 'restart',
        source: 'user'
    },
    autoReconnect: {
        applyMode: 'hot',
        source: 'user'
    },
    yield: {
        applyMode: 'hot',
        source: 'user'
    },
    cpuPriority: {
        applyMode: 'restart',
        source: 'user',
        min: -1,
        max: 5
    },
    affinity: {
        applyMode: 'restart',
        source: 'user'
    },
    hugePages: {
        applyMode: 'restart',
        source: 'user'
    },
    // Shown only when engine reports support; default unsupported in UI catalogs.
    msr: {
        applyMode: 'unsupported',
        source: 'default',
        reason: 'Requires elevated rights and verified desktop optimize path'
    },
    customShellArgs: {
        applyMode: 'unsupported',
        source: 'default',
        reason: 'Shell-concatenated args are forbidden'
    }
});

const EXPERT_ALLOWLIST = new Set([
    'threads',
    'cpu-affinity',
    'cpu-priority',
    'cpu-max-threads-hint',
    'randomx-mode',
    'huge-pages',
    'yield',
    'keepalive',
    'retry-pause',
    'print-time',
    'syslog',
    'verbose'
]);

const FORBIDDEN_EXPERT = [
    /donate/i,
    /api/i,
    /http-port/i,
    /access-token/i,
    /daemon/i,
    /password/i,
    /user=/i,
    /url=/i
];

/**
 * @param {object} [engineCaps]
 */
export function fieldCatalog(engineCaps = {}) {
    const out = {};
    for (const [key, meta] of Object.entries(FIELD_CATALOG)) {
        let applyMode = meta.applyMode;
        let reason = meta.reason || null;
        if (key === 'msr' && engineCaps.msr === true) {
            applyMode = 'restart';
            reason = null;
        }
        if (key === 'hugePages' && engineCaps.hugePages === false) {
            applyMode = 'unsupported';
            reason = 'Huge pages not available on this host';
        }
        if (key === 'affinity' && engineCaps.affinity === false) {
            applyMode = 'unsupported';
            reason = 'Affinity not editable on this platform';
        }
        out[key] = { ...meta, applyMode, reason, key };
    }
    return out;
}

/**
 * Build a staged plan comparing draft vs effective (running) config.
 * @param {object} input
 */
export function stageApply(input = {}) {
    const catalog = fieldCatalog(input.engineCaps || {});
    const draft = input.draft || {};
    const effective = input.effective || {};
    const locked = new Set(input.lockedFields || []);
    const applying = Boolean(input.applying);
    const lastKnownGood = input.lastKnownGood || effective;

    if (applying) {
        return {
            ok: false,
            reentryBlocked: true,
            reason: 'Apply already in progress',
            fields: [],
            hot: [],
            restart: [],
            unsupported: [],
            blocked: []
        };
    }

    const fields = [];
    const hot = [];
    const restart = [];
    const unsupported = [];
    const blocked = [];

    for (const key of Object.keys(catalog)) {
        if (!(key in draft) && !(key in effective)) continue;
        const meta = catalog[key];
        const from = effective[key];
        const to = draft[key];
        if (stableEqual(from, to)) continue;

        const entry = {
            key,
            from: redactValue(key, from, meta),
            to: redactValue(key, to, meta),
            applyMode: meta.applyMode,
            locked: locked.has(key),
            reason: meta.reason || null
        };

        if (locked.has(key) && input.allowLockedOverwrite !== true) {
            entry.blockedReason = 'Field is manually locked';
            blocked.push(entry);
            fields.push(entry);
            continue;
        }
        if (meta.applyMode === 'unsupported') {
            unsupported.push(entry);
            fields.push(entry);
            continue;
        }
        if (meta.applyMode === 'hot') hot.push(entry);
        if (meta.applyMode === 'restart') restart.push(entry);
        fields.push(entry);
    }

    const needsRestart = restart.length > 0;
    const canHotOnly = hot.length > 0 && restart.length === 0 && unsupported.length === 0 && blocked.length === 0;

    return {
        ok: fields.length > 0 && blocked.length === 0 && unsupported.filter((u) => u.key in draft).length === 0,
        reentryBlocked: false,
        dirty: fields.length > 0,
        needsRestart,
        canHotOnly,
        savedButNotEffective: needsRestart,
        runningRevision: input.runningRevision ?? 0,
        draftRevision: (input.draftRevision ?? 0) + 1,
        fields,
        hot,
        restart,
        unsupported,
        blocked,
        lastKnownGood,
        summary: summarize(hot, restart, blocked, unsupported)
    };
}

/**
 * Apply plan outcome. On failure, engine rolls back to lastKnownGood; draft kept.
 */
export function commitApply(plan, outcome = { success: true }) {
    if (!plan || plan.reentryBlocked) {
        return {
            applied: false,
            engine: plan?.lastKnownGood || {},
            draftPreserved: true,
            reason: plan?.reason || 'No plan'
        };
    }
    if (outcome.success) {
        return {
            applied: true,
            engine: outcome.engine || {},
            effectiveRevision: (plan.runningRevision || 0) + 1,
            draftPreserved: Boolean(plan.needsRestart),
            pendingRestart: Boolean(plan.needsRestart),
            reason: plan.needsRestart
                ? 'Saved — restart required for some fields'
                : 'Hot-applied'
        };
    }
    return {
        applied: false,
        engine: plan.lastKnownGood || {},
        draftPreserved: true,
        reason: outcome.reason || 'Apply failed — rolled back to last-known-good'
    };
}

/**
 * Validate expert argv / JSON keys. No shell concatenation.
 */
export function validateExpertArgs(input = {}) {
    const errors = [];
    const argv = Array.isArray(input.argv) ? input.argv : [];
    const json = input.json && typeof input.json === 'object' ? input.json : null;

    for (const arg of argv) {
        const s = String(arg);
        if (/[\r\n;|&`$]/.test(s) || s.includes('$(') || s.includes('`')) {
            errors.push(`Forbidden shell metacharacters in argv: ${s.slice(0, 40)}`);
        }
        if (s.startsWith('--')) {
            const key = s.replace(/^--/, '').split('=')[0];
            if (!EXPERT_ALLOWLIST.has(key)) {
                errors.push(`Unknown or disallowed flag: --${key}`);
            }
            for (const re of FORBIDDEN_EXPERT) {
                if (re.test(key) || re.test(s)) {
                    errors.push(`Forbidden sensitive override: ${key}`);
                }
            }
        }
    }

    // Duplicate flags
    const seen = new Set();
    for (const arg of argv) {
        const key = String(arg).replace(/^--/, '').split('=')[0];
        if (seen.has(key)) errors.push(`Duplicate flag: ${key}`);
        seen.add(key);
    }

    if (json) {
        for (const key of Object.keys(json)) {
            if (key === 'pools' || key === 'api' || key === 'http' || key === 'donate-level') {
                errors.push(`JSON key '${key}' cannot be overridden via expert paste`);
            }
        }
    }

    return {
        ok: errors.length === 0,
        errors,
        normalizedArgv: errors.length === 0 ? [...argv] : []
    };
}

/**
 * Tuner must not overwrite locked fields.
 */
export function mergeTunerUpdate(current = {}, tunerPatch = {}, lockedFields = []) {
    const locked = new Set(lockedFields);
    const next = { ...current };
    const skipped = [];
    for (const [k, v] of Object.entries(tunerPatch || {})) {
        if (locked.has(k)) {
            skipped.push(k);
            continue;
        }
        next[k] = v;
    }
    return { config: next, skipped };
}

function redactValue(key, value, meta) {
    if (value == null) return value;
    if (meta?.sensitive || /wallet|password|token/i.test(key)) {
        const s = String(value);
        if (s.length <= 8) return '***';
        return `${s.slice(0, 4)}…${s.slice(-4)}`;
    }
    return value;
}

function stableEqual(a, b) {
    if (Object.is(a, b)) return true;
    return JSON.stringify(a) === JSON.stringify(b);
}

function summarize(hot, restart, blocked, unsupported) {
    const parts = [];
    if (hot.length) parts.push(`${hot.length} hot`);
    if (restart.length) parts.push(`${restart.length} need restart`);
    if (blocked.length) parts.push(`${blocked.length} locked`);
    if (unsupported.length) parts.push(`${unsupported.length} unsupported`);
    return parts.join(', ') || 'No changes';
}

export { EXPERT_ALLOWLIST };
