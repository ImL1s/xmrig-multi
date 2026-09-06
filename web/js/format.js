/**
 * Display vocabulary for the web console.
 *
 * Mirrors `app/src/main/java/com/iml1s/xmrigminer/presentation/format/MetricDisplay.kt` so both
 * platforms agree on units and on what an unknown value looks like. The rule that matters: an
 * unknown must never be formatted as `0` (#54, #59).
 */

/** @typedef {'measured'|'estimated'|'pending'|'unavailable'|'stale'} Quality */

/** En dash rather than an empty string, so a screen reader still announces the field. */
export const PLACEHOLDER = '–';

/**
 * Placeholder for the hero readout.
 *
 * At display size a lone dash reads as a rendering glitch, so the hero keeps the shape of a
 * hashrate with the digits struck out. Still not a zero.
 */
export const HASHRATE_PLACEHOLDER = '–.–– H/s';

/**
 * @param {string} text
 * @param {Quality} quality
 * @returns {{ text: string, quality: Quality, hasValue: boolean }}
 */
function value(text, quality = 'measured') {
    return { text, quality, hasValue: true };
}

/** @param {Quality} quality */
function absent(quality) {
    return { text: PLACEHOLDER, quality, hasValue: false };
}

/** Hashrate in SI steps. Uses `en-US` numerals so a comma locale cannot creep into the digits. */
export function hashrateText(rate) {
    const abs = Math.abs(rate);
    if (abs >= 1e6) return `${(rate / 1e6).toFixed(2)} MH/s`;
    if (abs >= 1e3) return `${(rate / 1e3).toFixed(2)} kH/s`;
    if (abs >= 100) return `${rate.toFixed(1)} H/s`;
    return `${rate.toFixed(2)} H/s`;
}

/**
 * A running miner that has not closed its first sampling window is `pending`, not `0.00 H/s`.
 * A stopped miner has nothing to report at all.
 */
export function hashrate(rate, isMining) {
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) {
        return absent(isMining ? 'pending' : 'unavailable');
    }
    if (rate === 0) {
        return absent(isMining ? 'pending' : 'unavailable');
    }
    return value(hashrateText(rate));
}

/** With no shares submitted there is no rate; "0.0%" would read as "everything was rejected". */
export function shareSuccessRate(accepted, rejected) {
    if (!Number.isInteger(accepted) || !Number.isInteger(rejected)) return absent('unavailable');
    if (accepted < 0 || rejected < 0) return absent('unavailable');
    const total = accepted + rejected;
    if (total === 0) return absent('unavailable');
    return value(`${((accepted / total) * 100).toFixed(1)}%`);
}

/** Elapsed run time as H:MM:SS. A negative duration is a clock problem, not a duration. */
export function uptime(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
        return absent('unavailable');
    }
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return value(`${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
}

/** Thousands separators for counters. Never applied to anything sent over the wire. */
export function count(n) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return PLACEHOLDER;
    return Math.floor(n).toLocaleString('en-US');
}

/**
 * Head and tail of a payout address for the launch summary.
 *
 * Enough to check against a wallet without printing the whole string into a shared screen or a
 * screenshot (#56).
 */
export function elideAddress(address, head = 8, tail = 6) {
    const addr = (address || '').trim();
    if (!addr) return '';
    if (addr.length <= head + tail + 1) return addr;
    return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/** Human-readable wording for a quality tag. Single source so the two platforms match. */
export const QUALITY_LABEL = {
    measured: '量測值',
    estimated: '估計',
    pending: '取樣中',
    unavailable: '無法量測',
    stale: '已過期'
};
