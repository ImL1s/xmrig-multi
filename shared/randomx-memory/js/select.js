/**
 * Safe RandomX mode selection (#35).
 * Auto chooses light/fast within soft budget; never bypasses hard OS limits.
 * Manual locks are not overwritten by auto fallback.
 */

import { ALGORITHMS, resolveAlgorithmId } from './constants.js';
import { estimateMemory } from './estimate.js';

/**
 * @typedef {object} SelectInput
 * @property {string} [algorithm]
 * @property {'auto'|'fast'|'light'} [requestedMode]
 * @property {boolean} [locked] when true, do not change permanent manual mode
 * @property {number} [threads]
 * @property {number} [numaNodes]
 * @property {number|null} [availableBytes]
 * @property {number|null} [totalBytes]
 * @property {number|null} [processLimitBytes]
 * @property {number} [appReserveMiB]
 * @property {boolean} [confirmSoftOverride] user confirmed exceeding soft budget
 * @property {boolean} [allocationFailed] previous init OOM — force light retry path
 */

/**
 * @param {SelectInput} input
 */
export function selectRandomXMode(input = {}) {
    const algoId = resolveAlgorithmId(input.algorithm || 'rx/0');
    const algo = ALGORITHMS[algoId];
    const requested = normalizeMode(input.requestedMode);
    const locked = Boolean(input.locked);
    const reasons = [];

    if (!algo || algoId === 'astrobwt/v3') {
        return {
            ok: true,
            mode: 'auto',
            appliedMode: null,
            blocked: false,
            reasons: ['RandomX mode N/A for this algorithm'],
            estimate: estimateMemory({ ...input, algorithm: algoId, mode: requested }),
            requiresSoftConfirm: false,
            fallbackApplied: false,
            retryHint: null
        };
    }

    if (input.allocationFailed) {
        const lightEst = estimateMemory({ ...input, algorithm: algoId, mode: 'light' });
        if (locked && requested === 'fast') {
            return {
                ok: false,
                mode: requested,
                appliedMode: null,
                blocked: true,
                reasons: [
                    'Previous allocation failed; locked fast mode not auto-downgraded',
                    'Unlock or switch to light to retry with lower memory'
                ],
                estimate: lightEst,
                requiresSoftConfirm: false,
                fallbackApplied: false,
                retryHint: 'Switch to light mode and retry once — do not loop forever'
            };
        }
        return {
            ok: true,
            mode: locked ? requested : 'light',
            appliedMode: 'light',
            blocked: false,
            reasons: [
                'Previous allocation/OS pressure failure — retrying light mode once',
                'Will not infinite-restart on OOM'
            ],
            estimate: lightEst,
            requiresSoftConfirm: false,
            fallbackApplied: !locked,
            retryHint: 'Retry light once after freeing memory'
        };
    }

    if (requested === 'auto') {
        const fast = evaluateMode(algoId, 'fast', input, reasons);
        if (fast.ok) {
            return {
                ok: true,
                mode: 'auto',
                appliedMode: 'fast',
                blocked: false,
                reasons: [...reasons],
                estimate: fast.estimate,
                requiresSoftConfirm: false,
                fallbackApplied: false,
                retryHint: null
            };
        }
        const light = evaluateMode(algoId, 'light', input, reasons);
        return {
            ok: light.ok,
            mode: 'auto',
            appliedMode: light.ok ? 'light' : null,
            blocked: !light.ok,
            reasons: [...reasons],
            estimate: light.estimate,
            requiresSoftConfirm: light.requiresSoftConfirm,
            fallbackApplied: fast.ok === false && light.ok,
            retryHint: light.ok ? null : 'Free memory or lower threads'
        };
    }

    // Manual fast / light
    const trial = evaluateMode(algoId, requested, input, reasons);

    if (trial.ok) {
        return {
            ok: true,
            mode: requested,
            appliedMode: requested,
            blocked: false,
            reasons: [...reasons],
            estimate: trial.estimate,
            requiresSoftConfirm: false,
            fallbackApplied: false,
            retryHint: null
        };
    }

    if (trial.requiresSoftConfirm && input.confirmSoftOverride && !trial.hardBlocked) {
        reasons.push('User confirmed soft-budget override');
        return {
            ok: true,
            mode: requested,
            appliedMode: requested,
            blocked: false,
            reasons: [...reasons],
            estimate: trial.estimate,
            requiresSoftConfirm: false,
            fallbackApplied: false,
            retryHint: null
        };
    }

    if (locked) {
        return {
            ok: false,
            mode: requested,
            appliedMode: null,
            blocked: true,
            reasons: [
                ...reasons,
                'Manual mode locked — not overwritten by auto fallback',
                trial.hardBlocked
                    ? 'Hard OS/process limit would be exceeded'
                    : 'Soft budget exceeded — confirm override or unlock'
            ],
            estimate: trial.estimate,
            requiresSoftConfirm: trial.requiresSoftConfirm,
            fallbackApplied: false,
            retryHint: trial.hardBlocked
                ? 'Reduce threads or use light mode'
                : 'Confirm soft override or switch to light'
        };
    }

    // Unlocked manual fast → session fallback to light when possible
    if (requested === 'fast' && algo.supportsLight) {
        const light = evaluateMode(algoId, 'light', input, reasons);
        if (light.ok) {
            reasons.push('Fast blocked this session — applied light; permanent preference unchanged');
            return {
                ok: true,
                mode: 'fast',
                appliedMode: 'light',
                blocked: false,
                reasons: [...reasons],
                estimate: light.estimate,
                requiresSoftConfirm: false,
                fallbackApplied: true,
                retryHint: 'Restore fast when more RAM is available'
            };
        }
    }

    return {
        ok: false,
        mode: requested,
        appliedMode: null,
        blocked: true,
        reasons: [...reasons],
        estimate: trial.estimate,
        requiresSoftConfirm: trial.requiresSoftConfirm,
        fallbackApplied: false,
        retryHint: 'Free memory, lower threads, or use light mode'
    };
}

function evaluateMode(algoId, mode, input, reasons) {
    const estimate = estimateMemory({ ...input, algorithm: algoId, mode });
    const algo = ALGORITHMS[algoId];

    if (mode === 'fast' && !algo.supportsFast) {
        reasons.push(`${algo.displayName} fast mode unsupported`);
        return { ok: false, estimate, hardBlocked: true, requiresSoftConfirm: false };
    }
    if (mode === 'light' && !algo.supportsLight) {
        reasons.push(`${algo.displayName} light mode unsupported`);
        return { ok: false, estimate, hardBlocked: true, requiresSoftConfirm: false };
    }

    if (estimate.fitsHardLimit === false) {
        reasons.push(
            `Hard process limit too low for ${mode} (~${Math.round(estimate.miningBytes / (1024 * 1024))} MiB mining)`
        );
        return { ok: false, estimate, hardBlocked: true, requiresSoftConfirm: false };
    }

    if (estimate.softBudgetBytes == null) {
        if (mode === 'light') {
            reasons.push('Memory unknown — light is the safe default');
            return { ok: true, estimate, hardBlocked: false, requiresSoftConfirm: false };
        }
        reasons.push('Memory unknown — fast not selected without soft confirmation');
        return { ok: false, estimate, hardBlocked: false, requiresSoftConfirm: true };
    }

    if (estimate.fitsSoftBudget === false) {
        reasons.push(`${mode} estimate exceeds soft budget`);
        return { ok: false, estimate, hardBlocked: false, requiresSoftConfirm: true };
    }

    reasons.push(`${mode} fits soft budget (confidence=${estimate.confidence})`);
    return { ok: true, estimate, hardBlocked: false, requiresSoftConfirm: false };
}

function normalizeMode(mode) {
    const m = String(mode || 'auto').toLowerCase();
    if (m === 'fast' || m === 'light' || m === 'auto') return m;
    return 'auto';
}
