/**
 * WidgetKit timeline refresh policy (#78) — no per-second reload.
 */

import { nextTickMs } from '../../ambient-clock/js/ambient.js';

/**
 * @param {number} nowMs
 * @param {{ showSeconds?: boolean, maxEntries?: number }} [opts]
 */
export function planGlanceTimeline(nowMs, opts = {}) {
  const showSeconds = opts.showSeconds === true;
  const maxEntries = Math.min(12, Math.max(1, opts.maxEntries ?? 6));
  /** @type {{ atMs: number, reason: string }[]} */
  const entries = [];
  let t = nowMs;
  for (let i = 0; i < maxEntries; i++) {
    const delay = nextTickMs(t, { showSeconds });
    t = t + delay;
    entries.push({
      atMs: t,
      reason: showSeconds ? 'second-tick (clock-only)' : 'minute-aligned widget refresh'
    });
  }
  return {
    entries,
    policy: showSeconds ? 'atEnd' : 'after',
    reloadAfterMs: entries[0]?.atMs - nowMs,
    forbids: [
      'per-second hashrate polling via WidgetKit',
      'background RandomX inside widget extension',
      'push storms to fake live mining'
    ]
  };
}
