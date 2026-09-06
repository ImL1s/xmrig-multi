/**
 * Launch gate + fake-allocator contract (#129).
 * Blocked selections must never create cache/dataset; retry budget is session-owned.
 */

import { selectRandomXMode } from './select.js';

/**
 * Session-scoped OOM light-retry budget. Survives policy rebuilds only when the
 * same generation/seed is reused — a new generation resets the counter.
 */
export class OomRetryBudget {
    /**
     * @param {number} [maxRetries=1]
     */
    constructor(maxRetries = 1) {
        this.maxRetries = Math.max(0, Math.floor(maxRetries));
        this.generation = null;
        this.used = 0;
    }

    /**
     * @param {string|number} generation session / seed id
     */
    bind(generation) {
        const g = generation == null ? null : String(generation);
        if (g !== this.generation) {
            this.generation = g;
            this.used = 0;
        }
    }

    remaining() {
        return Math.max(0, this.maxRetries - this.used);
    }

    /**
     * @returns {boolean} true when a light retry may proceed
     */
    consume() {
        if (this.used >= this.maxRetries) return false;
        this.used += 1;
        return true;
    }
}

/**
 * @typedef {object} FakeAllocator
 * @property {() => void} createCache
 * @property {() => void} createDataset
 * @property {() => void} releaseAll
 * @property {() => { cache: number, dataset: number, live: number }} snapshot
 */

/**
 * @returns {FakeAllocator & { calls: { cache: number, dataset: number }, released: boolean }}
 */
export function createFakeAllocator() {
    const state = { cache: 0, dataset: 0, live: 0, released: false };
    return {
        calls: state,
        get released() {
            return state.released;
        },
        createCache() {
            state.cache += 1;
            state.live += 1;
            state.released = false;
        },
        createDataset() {
            state.dataset += 1;
            state.live += 1;
            state.released = false;
        },
        releaseAll() {
            state.live = 0;
            state.released = true;
        },
        snapshot() {
            return { cache: state.cache, dataset: state.dataset, live: state.live };
        }
    };
}

/**
 * Evaluate memory gate then optionally allocate. Blocked → zero allocations.
 *
 * @param {import('./select.js').SelectInput} input
 * @param {{ allocator?: ReturnType<typeof createFakeAllocator>, retryBudget?: OomRetryBudget, sessionGeneration?: string|number }} [opts]
 */
export function attemptRandomXLaunch(input = {}, opts = {}) {
    const allocator = opts.allocator || createFakeAllocator();
    const budget = opts.retryBudget || null;
    if (budget && opts.sessionGeneration != null) {
        budget.bind(opts.sessionGeneration);
    }

    let effective = { ...input };
    if (input.allocationFailed) {
        if (!budget) {
            // Callers without a budget still evaluate once via select — no silent bypass.
        } else if (!budget.consume()) {
            return {
                ok: false,
                blocked: true,
                launched: false,
                appliedMode: null,
                reasons: ['OOM light retry budget exhausted for this session'],
                selection: selectRandomXMode({ ...input, allocationFailed: false }),
                allocations: allocator.snapshot(),
                released: allocator.released
            };
        }
    }

    const selection = selectRandomXMode(effective);
    if (!selection.ok || selection.blocked || !selection.appliedMode) {
        return {
            ok: false,
            blocked: true,
            launched: false,
            appliedMode: null,
            reasons: selection.reasons,
            selection,
            allocations: allocator.snapshot(),
            released: allocator.released
        };
    }

    allocator.createCache();
    if (selection.appliedMode === 'fast') {
        allocator.createDataset();
    }

    return {
        ok: true,
        blocked: false,
        launched: true,
        appliedMode: selection.appliedMode,
        reasons: selection.reasons,
        selection,
        allocations: allocator.snapshot(),
        released: allocator.released
    };
}
