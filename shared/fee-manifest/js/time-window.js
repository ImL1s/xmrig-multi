/**
 * Fee time-window helpers (#63) — shared with DevFeePolicy / web proxy numbers.
 */

export const FEE_DEFAULTS = Object.freeze({
    percent: 1,
    wallet: '8AfUwcnoJiRDMXnDGj3zX6bMgfaj9pM1WFGr2pakLm3jSYXVLD5fcDMBzkmk4AeSqWYQTA5aerXJ43W65AT82RMqG6NDBnC',
    cycleSeconds: 6000,
    feeDurationSeconds: 60
});

export function isDevFeeWindow(elapsedSeconds, cfg = FEE_DEFAULTS) {
    if (elapsedSeconds < 0) return false;
    const cycle = cfg.cycleSeconds;
    const fee = cfg.feeDurationSeconds;
    const position = elapsedSeconds % cycle;
    return position >= (cycle - fee);
}

/**
 * Human summary: time-based fee is not an account deduction.
 */
export function describeBasis(basis) {
    if (basis === 'mining-time-window') {
        return 'Time share of hashing (not a wallet balance deduction; not a pool fee)';
    }
    if (basis === 'pool-policy') {
        return 'Pool operator fee — see pool docs; unknown must not display as 0%';
    }
    return basis || 'unknown';
}
