/**
 * RandomX memory estimator (#35).
 * Breaks down dataset / cache / per-worker scratchpad / NUMA duplication / app reserve.
 */

import {
    ALGORITHMS,
    DEFAULT_APP_RESERVE_MIB,
    MIB,
    SOFT_BUDGET_FRACTION,
    resolveAlgorithmId
} from './constants.js';

/**
 * @typedef {object} MemoryEstimateInput
 * @property {string} [algorithm] coin or algo id
 * @property {'auto'|'fast'|'light'} [mode]
 * @property {number} [threads] worker count (≥1)
 * @property {number} [numaNodes] ≥1; multiplies dataset in fast mode
 * @property {number|null} [availableBytes] live available RAM (null = unknown)
 * @property {number|null} [totalBytes]
 * @property {number|null} [processLimitBytes]
 * @property {number} [appReserveMiB]
 * @property {number} [softBudgetFraction]
 */

/**
 * @typedef {object} MemoryComponent
 * @property {string} name
 * @property {number} bytes
 * @property {string} role
 */

/**
 * @param {MemoryEstimateInput} input
 */
export function estimateMemory(input = {}) {
    const algoId = resolveAlgorithmId(input.algorithm || 'rx/0');
    const algo = ALGORITHMS[algoId];
    const threads = Math.max(1, Number.isFinite(input.threads) ? Math.floor(input.threads) : 1);
    const numa = Math.max(1, Number.isFinite(input.numaNodes) ? Math.floor(input.numaNodes) : 1);
    const modeReq = normalizeMode(input.mode);
    const appReserveMiB = Number.isFinite(input.appReserveMiB)
        ? input.appReserveMiB
        : DEFAULT_APP_RESERVE_MIB;
    const softFrac = Number.isFinite(input.softBudgetFraction)
        ? input.softBudgetFraction
        : SOFT_BUDGET_FRACTION;

    if (!algo || algoId === 'astrobwt/v3') {
        return nonRandomXEstimate(algoId, algo, threads, appReserveMiB, input);
    }

    const effectiveMode = modeReq === 'auto' ? 'fast' : modeReq; // estimate upper bound for auto→fast
    const components = [];

    const cacheBytes = algo.cacheMiB * MIB;
    components.push({
        name: 'cpu-cache',
        bytes: cacheBytes,
        role: 'RandomX cache (≈256 MiB first node; light mode working set)'
    });

    let datasetBytes = 0;
    if (effectiveMode === 'fast' && algo.datasetMiB != null) {
        datasetBytes = algo.datasetMiB * MIB * numa;
        components.push({
            name: 'dataset',
            bytes: datasetBytes,
            role: `Full dataset ≈${algo.datasetMiB} MiB × ${numa} NUMA node(s)`
        });
    }

    const scratchpadBytes = algo.scratchpadMiB * MIB * threads;
    components.push({
        name: 'scratchpad',
        bytes: scratchpadBytes,
        role: `Per-thread scratchpad ${algo.scratchpadMiB} MiB × ${threads} workers (not total engine RAM)`
    });

    const appReserveBytes = Math.max(0, appReserveMiB) * MIB;
    components.push({
        name: 'app-reserve',
        bytes: appReserveBytes,
        role: 'Application / OS soft reserve kept out of mining budget'
    });

    const miningBytes = cacheBytes + datasetBytes + scratchpadBytes;
    const totalEstimatedBytes = miningBytes + appReserveBytes;

    const available = finiteOrNull(input.availableBytes);
    const total = finiteOrNull(input.totalBytes);
    const processLimit = finiteOrNull(input.processLimitBytes);
    const budgetBase = pickBudgetBase(available, total, processLimit);
    const softBudgetBytes = budgetBase == null ? null : Math.floor(budgetBase * softFrac);

    const confidence = memoryConfidence(available, total, processLimit, modeReq);

    return {
        algorithm: algoId,
        displayName: algo.displayName,
        requestedMode: modeReq,
        /** Mode used for this numeric estimate (auto estimates as fast upper bound). */
        estimatedAsMode: effectiveMode,
        threads,
        numaNodes: numa,
        components,
        miningBytes,
        totalEstimatedBytes,
        softBudgetBytes,
        budgetBaseBytes: budgetBase,
        fitsSoftBudget: softBudgetBytes == null ? null : totalEstimatedBytes <= softBudgetBytes,
        fitsHardLimit: processLimit == null ? null : miningBytes <= processLimit,
        confidence,
        warnings: buildWarnings({
            algo,
            modeReq,
            effectiveMode,
            available,
            softBudgetBytes,
            totalEstimatedBytes,
            scratchpadBytes,
            datasetBytes
        }),
        unitsNote: 'All byte fields are integers. Scratchpad ≠ full RandomX RAM.'
    };
}

function nonRandomXEstimate(algoId, algo, threads, appReserveMiB, input) {
    const scratch = (algo?.scratchpadMiB || 0) * MIB * threads;
    const app = Math.max(0, appReserveMiB) * MIB;
    return {
        algorithm: algoId,
        displayName: algo?.displayName || 'Unknown',
        requestedMode: normalizeMode(input.mode),
        estimatedAsMode: null,
        threads,
        numaNodes: 1,
        components: [
            {
                name: 'scratchpad',
                bytes: scratch,
                role: 'Non-RandomX working set estimate'
            },
            {
                name: 'app-reserve',
                bytes: app,
                role: 'Application / OS soft reserve'
            }
        ],
        miningBytes: scratch,
        totalEstimatedBytes: scratch + app,
        softBudgetBytes: null,
        budgetBaseBytes: finiteOrNull(input.availableBytes) ?? finiteOrNull(input.totalBytes),
        fitsSoftBudget: null,
        fitsHardLimit: null,
        confidence: 'low',
        warnings: ['Not a RandomX algorithm — fast/light modes do not apply'],
        unitsNote: 'RandomX mode selection is N/A for this algorithm'
    };
}

function normalizeMode(mode) {
    const m = String(mode || 'auto').toLowerCase();
    if (m === 'fast' || m === 'light' || m === 'auto') return m;
    return 'auto';
}

function finiteOrNull(v) {
    if (v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.floor(n);
}

function pickBudgetBase(available, total, processLimit) {
    const candidates = [available, total, processLimit].filter((x) => x != null);
    if (!candidates.length) return null;
    return Math.min(...candidates);
}

function memoryConfidence(available, total, processLimit, modeReq) {
    if (available != null) return 'high';
    if (processLimit != null) return 'medium';
    if (total != null) return 'medium';
    if (modeReq === 'light') return 'low';
    return 'unknown';
}

function buildWarnings({
    algo,
    modeReq,
    effectiveMode,
    available,
    softBudgetBytes,
    totalEstimatedBytes,
    scratchpadBytes,
    datasetBytes
}) {
    const w = [];
    if (available == null) {
        w.push('Available RAM unknown — do not assume allocation will succeed after probe');
    }
    if (softBudgetBytes != null && totalEstimatedBytes > softBudgetBytes) {
        w.push('Estimated use exceeds soft budget — prefer light or fewer threads');
    }
    if (modeReq === 'auto' && effectiveMode === 'fast') {
        w.push('Auto estimate shows fast-mode upper bound; runtime may fall back to light');
    }
    if (datasetBytes > 0 && scratchpadBytes > 0 && scratchpadBytes < datasetBytes / 100) {
        w.push(
            `Scratchpad is only ${(scratchpadBytes / MIB).toFixed(0)} MiB total — ` +
            `full dataset is ~${(datasetBytes / MIB).toFixed(0)} MiB; UI must not label full mode as "2 MB"`
        );
    }
    if (modeReq === 'fast' && !algo.supportsFast) {
        w.push(`${algo.displayName} does not support fast mode on this build`);
    }
    return w;
}

/**
 * Format bytes as MiB string for UI (no fake precision).
 * @param {number} bytes
 */
export function formatMiB(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
    const mib = bytes / MIB;
    if (mib >= 100) return `~${Math.round(mib)} MiB`;
    if (mib >= 10) return `~${mib.toFixed(0)} MiB`;
    return `~${mib.toFixed(1)} MiB`;
}
