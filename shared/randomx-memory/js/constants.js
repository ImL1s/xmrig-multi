/**
 * Algorithm memory constants (#35 / #129).
 * Values are MiB unless noted. Scratchpad is per-worker, not total engine RAM.
 *
 * Engine pin: XMRig v6.21.0 (Android `scripts/build_xmrig.sh`).
 * Dataset sizes come from `RandomX_ConfigurationBase` in
 * https://github.com/xmrig/xmrig/blob/v6.21.0/src/crypto/randomx/randomx.h
 *   DatasetBaseSize  = 2147483648
 *   DatasetExtraSize = 33554368
 *   sum              = 2181038016 bytes ≈ 2079.9999 MiB
 * Estimator uses a conservative ceil to **2080 MiB** per NUMA node (fast mode).
 * RandomWOW inherits the common dataset; its 1 MiB value is the per-thread
 * scratchpad only — never treat cache (256 MiB) as the fast-mode dataset.
 */

/** @typedef {'rx/0'|'rx/wow'|'astrobwt/v3'|'unknown'} AlgoId */

export const MIB = 1024 * 1024;

/** Pinned XMRig tag used for RandomX size tables. */
export const ENGINE_VERSION = '6.21.0';

/** Upstream dataset byte total (base + extra) for RandomX_ConfigurationBase. */
export const ENGINE_DATASET_BASE_PLUS_EXTRA_BYTES = 2147483648 + 33554368;

/**
 * Page-aligned conservative MiB ceiling for fast-mode dataset estimates.
 * Must cover ENGINE_DATASET_BASE_PLUS_EXTRA_BYTES.
 */
export const ENGINE_DATASET_MIB = 2080;

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
        datasetMiB: ENGINE_DATASET_MIB,
        /** Dataset init / light-mode working set uses ~256 MiB cache. */
        cacheMiB: 256,
        /** Per-thread scratchpad — NOT the full-mode requirement. */
        scratchpadMiB: 2,
        supportsFast: true,
        supportsLight: true,
        notes: `Monero RandomX (rx/0); dataset from XMRig ${ENGINE_VERSION}`
    },
    'rx/wow': {
        id: 'rx/wow',
        displayName: 'RandomWOW',
        /**
         * Wownero inherits RandomX_ConfigurationBase dataset (same ~2080 MiB).
         * Do not confuse with cache (256 MiB) or scratchpad (1 MiB/thread).
         */
        datasetMiB: ENGINE_DATASET_MIB,
        cacheMiB: 256,
        scratchpadMiB: 1,
        supportsFast: true,
        supportsLight: true,
        notes: `Wownero RandomWOW — dataset from XMRig ${ENGINE_VERSION} base config; scratchpad 1 MiB`
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
