/**
 * Ambient clock policy (#74) — pure clock without mining side effects.
 */

export const SCHEMA_VERSION = 1;

/** @typedef {'clock_only'|'clock_and_mine'|'remote_watch'} AmbientMode */

export const MODES = Object.freeze(['clock_only', 'clock_and_mine', 'remote_watch']);

/**
 * @param {object} input
 * @param {AmbientMode} [input.requested]
 * @param {boolean} [input.hasWallet]
 * @param {boolean} [input.minerAvailable]
 * @param {boolean} [input.remotePaired]
 */
export function resolveAmbientMode(input = {}) {
  const requested = MODES.includes(input.requested) ? input.requested : 'clock_only';
  if (requested === 'clock_only') {
    return {
      mode: 'clock_only',
      showMinerCard: false,
      mayRequestMine: false,
      requiresWallet: false,
      requiresNetwork: false
    };
  }
  if (requested === 'remote_watch') {
    return {
      mode: 'remote_watch',
      showMinerCard: true,
      mayRequestMine: false,
      requiresWallet: false,
      requiresNetwork: Boolean(input.remotePaired),
      remoteReady: input.remotePaired === true
    };
  }
  // clock_and_mine — still does not auto-start; only displays if session exists
  return {
    mode: 'clock_and_mine',
    showMinerCard: true,
    mayRequestMine: input.minerAvailable === true && input.hasWallet === true,
    requiresWallet: true,
    requiresNetwork: false
  };
}

/**
 * Next UI refresh delay. Minute-aligned when showSeconds=false.
 * @param {number} nowMs
 * @param {{showSeconds?:boolean}} [opts]
 */
export function nextTickMs(nowMs, opts = {}) {
  const showSeconds = opts.showSeconds === true;
  if (showSeconds) {
    return 1000 - (nowMs % 1000);
  }
  return 60_000 - (nowMs % 60_000);
}

/**
 * Night dim factor for ambient window only (0.15–1).
 * @param {number} minuteOfDay 0–1439
 * @param {{nightStartMin?:number, nightEndMin?:number, nightFactor?:number}} [cfg]
 */
export function nightDimFactor(minuteOfDay, cfg = {}) {
  const start = cfg.nightStartMin ?? 22 * 60;
  const end = cfg.nightEndMin ?? 6 * 60;
  const factor = cfg.nightFactor ?? 0.35;
  const inNight =
    start === end
      ? false
      : start < end
        ? minuteOfDay >= start && minuteOfDay < end
        : minuteOfDay >= start || minuteOfDay < end;
  return inNight ? factor : 1;
}

/**
 * Format wall clock; uses provided parts (fake-clock friendly).
 * @param {{hours:number,minutes:number,seconds?:number,day?:number,month?:number,year?:number}} parts
 * @param {{hour12?:boolean, showSeconds?:boolean}} [opts]
 */
export function formatWallClock(parts, opts = {}) {
  const hour12 = opts.hour12 === true;
  const showSeconds = opts.showSeconds === true;
  let h = parts.hours;
  let suffix = '';
  if (hour12) {
    suffix = h >= 12 ? ' PM' : ' AM';
    h = h % 12;
    if (h === 0) h = 12;
  }
  const hh = String(h).padStart(2, '0');
  const mm = String(parts.minutes).padStart(2, '0');
  const base = showSeconds
    ? `${hh}:${mm}:${String(parts.seconds ?? 0).padStart(2, '0')}`
    : `${hh}:${mm}`;
  return base + suffix;
}

/**
 * Session elapsed from monotonic marks — immune to wall-clock jumps.
 * @param {number|null} startedMonoMs
 * @param {number} nowMonoMs
 */
export function sessionElapsedMs(startedMonoMs, nowMonoMs) {
  if (startedMonoMs == null || !Number.isFinite(startedMonoMs) || !Number.isFinite(nowMonoMs)) {
    return null;
  }
  if (nowMonoMs < startedMonoMs) return null;
  return nowMonoMs - startedMonoMs;
}

/**
 * Privacy: never expose full wallet on ambient surface.
 * @param {string|null|undefined} address
 */
export function redactAddress(address) {
  if (!address || typeof address !== 'string') return null;
  if (address.length < 12) return '••••';
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Pure clock must not imply mining process.
 */
export function ambientSideEffects(modeResolution) {
  return {
    startMiner: false,
    connectPool: false,
    requireWallet: modeResolution.requiresWallet === true && modeResolution.mode === 'clock_and_mine',
    loadRandomX: false
  };
}
