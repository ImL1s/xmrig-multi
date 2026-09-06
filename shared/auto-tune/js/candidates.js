/**
 * Safe candidate generator for auto-tune (#34).
 * Small search space from allowed cores + RandomX memory modes.
 */

import { selectRandomXMode } from '../../randomx-memory/js/select.js';

/** @typedef {'quiet'|'power'|'balanced'|'max_sustained'} TuneGoal */

/**
 * @param {object} opts
 * @param {object} [opts.snapshot]
 * @param {string} [opts.algorithm]
 * @param {string[]} [opts.lockedFields] e.g. ['cpu.threads','randomx.mode']
 * @param {number} [opts.lockedThreads]
 * @param {string} [opts.lockedRandomxMode]
 * @param {TuneGoal} [opts.goal]
 */
export function buildCandidates(opts = {}) {
    const snap = opts.snapshot || {};
    const allowed = snap.cpu?.allowed?.value ?? snap.cpu?.logical?.value ?? 1;
    const max = Math.max(1, Math.min(Number(allowed) || 1, 64));
    const locked = new Set(opts.lockedFields || []);
    const memAvail = snap.memory?.availableBytes?.value ?? null;
    const memTotal = snap.memory?.totalBytes?.value ?? null;
    const processLimit = snap.memory?.processLimitBytes?.value ?? null;
    const algorithm = opts.algorithm || 'rx/0';
    const goal = opts.goal || 'balanced';

    const threadSet = new Set();
    if (locked.has('cpu.threads') && Number.isInteger(opts.lockedThreads)) {
        threadSet.add(Math.max(1, Math.min(max, opts.lockedThreads)));
    } else {
        // Few safe points: 1, ~50%, max-1, max
        threadSet.add(1);
        if (max >= 2) threadSet.add(Math.max(1, Math.floor(max / 2)));
        if (max >= 3) threadSet.add(max - 1);
        threadSet.add(max);
        if ((goal === 'quiet' || goal === 'power') && max >= 2) {
            // Prefer lower thread counts — never delete the sole 1-core candidate (#128).
            threadSet.delete(max);
            threadSet.add(Math.max(1, Math.floor(max * 0.35)));
        }
        if (goal === 'max_sustained') {
            threadSet.add(max);
            if (max >= 2) threadSet.add(max - 1);
        }
        // Guarantee at least one legal thread count.
        if (threadSet.size === 0) threadSet.add(1);
    }

    const modeSet = new Set();
    if (locked.has('randomx.mode') && opts.lockedRandomxMode) {
        modeSet.add(opts.lockedRandomxMode);
    } else {
        const auto = selectRandomXMode({
            algorithm,
            requestedMode: 'auto',
            threads: Math.max(...threadSet),
            availableBytes: memAvail,
            totalBytes: memTotal,
            processLimitBytes: processLimit
        });
        if (auto.appliedMode) modeSet.add(auto.appliedMode);
        modeSet.add('light');
        if (auto.appliedMode === 'fast' || (memAvail != null && memAvail >= 3 * 1024 * 1024 * 1024)) {
            modeSet.add('fast');
        }
    }

    /** @type {{ id: string, threads: number, randomxMode: string }[]} */
    const candidates = [];
    for (const threads of [...threadSet].sort((a, b) => a - b)) {
        for (const randomxMode of modeSet) {
            const gate = selectRandomXMode({
                algorithm,
                requestedMode: randomxMode,
                threads,
                availableBytes: memAvail,
                totalBytes: memTotal,
                processLimitBytes: processLimit,
                locked: locked.has('randomx.mode')
            });
            if (gate.blocked && !gate.ok) continue;
            const mode = gate.appliedMode || randomxMode;
            candidates.push({
                id: `t${threads}-${mode}`,
                threads,
                randomxMode: mode
            });
        }
    }

    // Cap search budget
    const capped = candidates.slice(0, 12);
    return {
        candidates: capped,
        maxThreads: max,
        reasons: [
            `goal=${goal}`,
            `search space ${capped.length} candidates (cap 12)`,
            locked.size ? `locked: ${[...locked].join(',')}` : 'no locks'
        ]
    };
}
