/**
 * Algorithm memory constants (#35).
 * Values are MiB unless noted. Scratchpad is per-worker, not total engine RAM.
 *
 * Sources: XMRig RandomX optimization guide + algorithms table.
 * WOW uses its own sizes — do not reuse Monero dataset constants.
 */

/** @typedef {'rx/0'|'rx/wow'|'astrobwt/v3'|'unknown'} AlgoId */

export const MIB = 1024 * 1024;

/**
 * Default app / OS reserve kept out of the soft mining budget (MiB).
 * Platforms may raise this (Android ART, browser tab, etc.).
 */
export const DEFAULT_APP_RESERVE_MIB = 256;

/**
 * Soft fraction of available RAM we are willing to claim for mining.
 * Remaining headroom absorbs init peaks and other processes.
 */
export const SOFT_BUDGET_FRACTION = 0.75;

/** @type {Record<string, {
 *   id: string,
 *   displayName: string,
 *   datasetMiB: number|null,
 *   cacheMiB: number,
 *   scratchpadMiB: number,
 *   supportsFast: boolean,
 *   supportsLight: boolean,
 *   notes: string
 * }>} */
export const ALGORITHMS = {
    'rx/0': {
        id: 'rx/0',
        displayName: 'RandomX',
        /** Full dataset ≈ 2080 MiB per NUMA node (fast mode). */
        datasetMiB: 2080,
        /** Dataset init / light-mode working set uses ~256 MiB cache. */
        cacheMiB: 256,
        /** Per-thread scratchpad — NOT the full-mode requirement. */
        scratchpadMiB: 2,
        supportsFast: true,
        supportsLight: true,
        notes: 'Monero RandomX (rx/0)'
    },
    'rx/wow': {
        id: 'rx/wow',
        displayName: 'RandomWOW',
        /** RandomWOW dataset is much smaller than Monero; still not "1 MB total". */
        datasetMiB: 256,
        cacheMiB: 256,
        scratchpadMiB: 1,
        supportsFast: true,
        supportsLight: true,
        notes: 'Wownero RandomWOW — own constants, not Monero copies'
    },
    'astrobwt/v3': {
        id: 'astrobwt/v3',
        displayName: 'AstroBWT/v3',
        datasetMiB: null,
        cacheMiB: 0,
        scratchpadMiB: 20,
        supportsFast: false,
        supportsLight: false,
        notes: 'DERO — not RandomX; estimator returns N/A for RX modes'
    }
};

/**
 * @param {string} coinOrAlgo
 * @returns {keyof typeof ALGORITHMS | 'unknown'}
 */
export function resolveAlgorithmId(coinOrAlgo) {
    const s = String(coinOrAlgo || '').toLowerCase();
    if (s === 'rx/0' || s === 'randomx' || s === 'monero' || s === 'xmr') return 'rx/0';
    if (s === 'rx/wow' || s === 'randomwow' || s === 'wownero' || s === 'wow') return 'rx/wow';
    if (s.includes('astro') || s === 'dero') return 'astrobwt/v3';
    if (ALGORITHMS[s]) return s;
    return 'unknown';
}
