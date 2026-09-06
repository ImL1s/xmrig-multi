/**
 * Deterministic 32-bit nonce space helpers for web workers (#49).
 * Nonce is unsigned 32-bit; rollover wraps in [0, 2^32).
 */

export const NONCE_MOD = 0x100000000; // 2^32

/** @param {number} n */
export function toUint32(n) {
    return Number(n) >>> 0;
}

/**
 * Next nonce after `n` with correct 32-bit wrap (including 0xffffffff → 0).
 * @param {number} n
 */
export function nextNonce(n) {
    return toUint32(toUint32(n) + 1);
}

/**
 * Advance by `delta` with wrap. Prefer this over `% 0xffffffff` (off-by-one).
 * @param {number} n
 * @param {number} delta
 */
export function addNonce(n, delta) {
    return toUint32(toUint32(n) + toUint32(delta));
}

/**
 * Partition nonce space across workers for a job generation.
 * Worker `i` of `count` starts at i and strides by count (when count is power of 2
 * this is a clean partition; otherwise still collision-minimizing).
 *
 * @param {number} workerIndex 0-based
 * @param {number} workerCount
 * @param {number} jobGeneration used as salt so resume/reseed changes start
 * @returns {{ start: number, stride: number, jobGeneration: number }}
 */
export function allocateNonceSpace(workerIndex, workerCount, jobGeneration) {
    const count = Math.max(1, Math.floor(workerCount) || 1);
    const idx = Math.max(0, Math.floor(workerIndex) || 0) % count;
    const salt = toUint32(jobGeneration);
    const start = toUint32(idx + salt * count);
    return { start, stride: count, jobGeneration: salt };
}

/**
 * Job loop generation: bump on new job, resume, or seed change so duplicate
 * runBatch loops exit when currentJob.job_id OR loopGen mismatches.
 * @param {number} current
 */
export function bumpJobLoopGeneration(current) {
    return (Number(current) || 0) + 1;
}
