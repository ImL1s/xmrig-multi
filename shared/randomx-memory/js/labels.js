/**
 * Honest UI labels for RandomX memory (#35).
 * Never claim "Full mode (2MB)" — that confuses scratchpad with dataset.
 */

import { ALGORITHMS, MIB, resolveAlgorithmId } from './constants.js';
import { estimateMemory, formatMiB } from './estimate.js';

/**
 * Short algorithm line for config screens.
 * @param {string} coinOrAlgo
 * @param {'auto'|'fast'|'light'} [mode]
 * @param {{ threads?: number, availableBytes?: number|null }} [opts]
 */
export function algorithmMemorySummary(coinOrAlgo, mode = 'auto', opts = {}) {
    const id = resolveAlgorithmId(coinOrAlgo);
    const algo = ALGORITHMS[id];
    if (!algo) {
        return {
            title: String(coinOrAlgo || 'Unknown'),
            detail: 'Memory requirements unknown',
            scratchpadNote: null,
            datasetNote: null
        };
    }
    if (id === 'astrobwt/v3') {
        return {
            title: `${algo.displayName} — CPU optimized`,
            detail: 'Not RandomX; fast/light modes do not apply',
            scratchpadNote: `Per-thread working set ~${algo.scratchpadMiB} MiB (estimate)`,
            datasetNote: null
        };
    }

    const est = estimateMemory({
        algorithm: id,
        mode,
        threads: opts.threads || 1,
        availableBytes: opts.availableBytes ?? null
    });
    const modeLabel = mode === 'light' ? 'light' : mode === 'fast' ? 'fast' : 'auto (prefer fast if RAM allows)';

    return {
        title: `${algo.displayName} — ${modeLabel}`,
        detail:
            `Scratchpad ${algo.scratchpadMiB} MiB/thread · ` +
            `cache ~${algo.cacheMiB} MiB` +
            (algo.datasetMiB != null ? ` · dataset ~${algo.datasetMiB} MiB/NUMA (fast)` : ''),
        scratchpadNote:
            `Per-thread scratchpad is ${algo.scratchpadMiB} MiB — not the full engine RAM requirement.`,
        datasetNote:
            algo.datasetMiB != null
                ? `Fast mode needs ~${algo.datasetMiB} MiB dataset per NUMA node plus cache and scratchpads.`
                : null,
        estimateLine:
            `Estimated mining footprint ${formatMiB(est.miningBytes)}` +
            (est.softBudgetBytes != null ? ` (soft budget ${formatMiB(est.softBudgetBytes)})` : ' (budget unknown)')
    };
}

/**
 * Component breakdown lines for advanced UI.
 * @param {object} estimate from estimateMemory()
 */
export function breakdownLines(estimate) {
    if (!estimate?.components) return [];
    return estimate.components.map((c) => ({
        name: c.name,
        label: c.role,
        size: formatMiB(c.bytes),
        bytes: c.bytes
    }));
}

/**
 * Guard against legacy misleading strings in tests / migrations.
 * @param {string} text
 */
export function isMisleadingFullModeLabel(text) {
    const s = String(text || '');
    return /full\s*mode\s*\(\s*2\s*m/i.test(s) || /randomx\s*[-–—]\s*full\s*mode\s*\(\s*2/i.test(s);
}

export { MIB };
