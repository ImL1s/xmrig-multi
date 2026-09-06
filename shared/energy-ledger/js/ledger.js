/**
 * Energy sample normalization, unit conversion, and durable ledger (#70).
 *
 * Quality contract: unknown power never becomes 0 W / 0 kWh.
 */

/** @typedef {'wall'|'usb'|'cpu_package'|'gpu'|'battery_net'|'manual'} EnergyScope */
/** @typedef {'manual'|'measured'|'estimated'|'unknown'} EnergyQuality */
/** @typedef {'W'|'Wh'|'kWh'|'mWh'|'nWh'} EnergyUnit */
/** @typedef {'off'|'idle'|'clock'} BaselineMode */

export const SCHEMA_VERSION = 1;

export const SCOPES = Object.freeze([
  'wall',
  'usb',
  'cpu_package',
  'gpu',
  'battery_net',
  'manual'
]);

export const QUALITIES = Object.freeze(['manual', 'measured', 'estimated', 'unknown']);

/** Sources that must never be labeled measured (TDP / % / nameplate). */
export const MEASURED_DENYLIST = Object.freeze([
  'tdp',
  'cpu-percent',
  'cpu%',
  'charger-rated',
  'nameplate',
  'psu-rating'
]);

const QUALITY_RANK = Object.freeze({
  measured: 3,
  manual: 2,
  estimated: 1,
  unknown: 0
});

function weakerQuality(a, b) {
  if (QUALITY_RANK[a] == null) return b;
  if (QUALITY_RANK[b] == null) return a;
  return QUALITY_RANK[a] <= QUALITY_RANK[b] ? a : b;
}

/**
 * Convert a quantity to watt-hours.
 * @param {number} value
 * @param {EnergyUnit} unit
 * @returns {number|null} null if unit unknown
 */
export function toWattHours(value, unit) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  switch (unit) {
    case 'W':
      return null; // Watts alone are not energy
    case 'Wh':
      return value;
    case 'kWh':
      return value * 1000;
    case 'mWh':
      return value / 1000;
    case 'nWh':
      return value / 1e9;
    default:
      return null;
  }
}

/**
 * Wh from average watts over a duration.
 * W × seconds / 3_600_000 = kWh; W × seconds / 3600 = Wh
 * @param {number} watts
 * @param {number} durationMs
 * @returns {number|null}
 */
export function integrateWatts(watts, durationMs) {
  if (typeof watts !== 'number' || !Number.isFinite(watts)) return null;
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
    return null;
  }
  // Wh = W × (ms / 3_600_000)
  return (watts * durationMs) / 3_600_000;
}

/**
 * @param {object} raw
 * @returns {object} normalized sample or rejected with reason
 */
export function normalizeSample(raw = {}) {
  const source = String(raw.source || 'unknown');
  const scope = SCOPES.includes(raw.scope) ? raw.scope : null;
  const sourceKey = source.toLowerCase();
  let quality = QUALITIES.includes(raw.quality) ? raw.quality : 'unknown';
  if (quality === 'measured' && MEASURED_DENYLIST.some((d) => sourceKey.includes(d))) {
    quality = 'estimated';
  }
  const unit = raw.unit || null;
  const value = raw.value;
  const startMs = Number(raw.startMs);
  const endMs = Number(raw.endMs ?? raw.startMs);
  const monotonicMs = raw.monotonicMs != null ? Number(raw.monotonicMs) : endMs;
  const utcMs = raw.utcMs != null ? Number(raw.utcMs) : endMs;
  const meterEpoch = raw.meterEpoch != null ? String(raw.meterEpoch) : 'default';
  const sessionId = raw.sessionId != null ? String(raw.sessionId) : null;
  const profileId = raw.profileId != null ? String(raw.profileId) : null;
  const includesDisplay = raw.includesDisplay === true;
  const includesChargingLoad = raw.includesChargingLoad === true;
  const sampleId = raw.sampleId != null ? String(raw.sampleId) : `${source}:${scope}:${startMs}:${endMs}:${value}:${unit}`;

  if (!scope) {
    return { ok: false, reason: 'invalid-scope', sampleId };
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return { ok: false, reason: 'invalid-interval', sampleId };
  }
  if (quality === 'unknown') {
    return {
      ok: true,
      sample: {
        sampleId,
        source,
        scope,
        quality: 'unknown',
        unit,
        value: null,
        wattHours: null,
        startMs,
        endMs,
        monotonicMs,
        utcMs,
        meterEpoch,
        sessionId,
        profileId,
        includesDisplay,
        includesChargingLoad,
        unknownReason: raw.unknownReason || 'quality-unknown'
      }
    };
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, reason: 'invalid-value', sampleId, quality: 'unknown' };
  }

  let wattHours = null;
  if (unit === 'W') {
    wattHours = integrateWatts(value, endMs - startMs);
    if (wattHours == null) {
      return { ok: false, reason: 'watt-integration-failed', sampleId };
    }
  } else {
    wattHours = toWattHours(value, unit);
    if (wattHours == null) {
      return { ok: false, reason: 'unsupported-unit', sampleId };
    }
  }

  return {
    ok: true,
    sample: {
      sampleId,
      source,
      scope,
      quality,
      unit,
      value,
      wattHours,
      startMs,
      endMs,
      monotonicMs,
      utcMs,
      meterEpoch,
      sessionId,
      profileId,
      includesDisplay,
      includesChargingLoad,
      unknownReason: null
    }
  };
}

/**
 * Detect counter reset / rollover between cumulative Wh readings.
 * @param {number|null} prevWh
 * @param {number} nextWh
 * @param {string} prevEpoch
 * @param {string} nextEpoch
 */
export function cumulativeDelta(prevWh, nextWh, prevEpoch, nextEpoch) {
  if (prevEpoch !== nextEpoch) {
    return { deltaWh: null, event: 'new-meter-epoch', unknown: true };
  }
  if (prevWh == null || !Number.isFinite(prevWh)) {
    return { deltaWh: null, event: 'no-baseline', unknown: true };
  }
  if (!Number.isFinite(nextWh)) {
    return { deltaWh: null, event: 'invalid-reading', unknown: true };
  }
  if (nextWh < prevWh) {
    return { deltaWh: null, event: 'counter-reset', unknown: true };
  }
  return { deltaWh: nextWh - prevWh, event: 'ok', unknown: false };
}

/**
 * In-memory durable ledger with dedupe and coverage tracking.
 */
export class EnergyLedger {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxGapMs] gaps larger than this become unknown coverage
   */
  constructor(opts = {}) {
    this.schemaVersion = SCHEMA_VERSION;
    this.maxGapMs = opts.maxGapMs ?? 15 * 60 * 1000;
    /** @type {Map<string, object>} */
    this.entries = new Map();
    /** @type {Map<string, {wh:number, epoch:string, endMs:number}>} */
    this.lastCumulative = new Map();
    this.committedWhByScope = Object.create(null);
    /** @type {Record<string, string>} weakest quality seen per scope */
    this.qualityByScope = Object.create(null);
    /** @type {Map<string, {startMs:number,endMs:number}[]>} */
    this.intervalsByScope = new Map();
    this.unknownCoverageMs = 0;
    this.knownCoverageMs = 0;
  }

  /**
   * Commit a normalized energy interval (already Wh) or raw sample.
   * @param {object} raw
   * @returns {{accepted:boolean, reason?:string, entry?:object}}
   */
  commit(raw) {
    // Pre-shaped samples (including unknown with wattHours=null) skip re-normalize.
    const preShaped = raw && raw.sampleId && Object.prototype.hasOwnProperty.call(raw, 'wattHours');
    const norm = preShaped ? { ok: true, sample: raw } : normalizeSample(raw);
    if (!norm.ok) {
      return { accepted: false, reason: norm.reason };
    }
    const s = norm.sample;
    if (this.entries.has(s.sampleId)) {
      return { accepted: false, reason: 'duplicate', entry: this.entries.get(s.sampleId) };
    }

    // Reject overlapping known energy intervals on the same scope.
    if (s.quality !== 'unknown' && s.wattHours != null) {
      const spans = this.intervalsByScope.get(s.scope) || [];
      for (const span of spans) {
        if (s.startMs < span.endMs && s.endMs > span.startMs) {
          return { accepted: false, reason: 'overlapping-interval' };
        }
      }
      spans.push({ startMs: s.startMs, endMs: s.endMs });
      this.intervalsByScope.set(s.scope, spans);
    }

    const durationMs = Math.max(0, s.endMs - s.startMs);
    const entry = {
      ...s,
      committedAtMs: s.utcMs,
      schemaVersion: SCHEMA_VERSION
    };

    if (s.quality === 'unknown' || s.wattHours == null) {
      this.unknownCoverageMs += durationMs;
      this.entries.set(s.sampleId, entry);
      return { accepted: true, entry };
    }

    this.knownCoverageMs += durationMs;
    const key = s.scope;
    this.committedWhByScope[key] = (this.committedWhByScope[key] || 0) + s.wattHours;
    this.qualityByScope[key] = weakerQuality(this.qualityByScope[key], s.quality);
    this.entries.set(s.sampleId, entry);
    return { accepted: true, entry };
  }

  /**
   * Commit from cumulative meter Wh reading (preferred over W integration).
   * @param {object} reading
   */
  commitCumulative(reading = {}) {
    const scope = reading.scope || 'wall';
    const source = reading.source || 'meter';
    const epoch = String(reading.meterEpoch || 'default');
    const endMs = Number(reading.endMs ?? reading.utcMs);
    const utcMs = Number(reading.utcMs ?? endMs);
    const meterKey = `${source}:${scope}`;
    const wh = toWattHours(reading.value, reading.unit || 'Wh');
    if (wh == null || !Number.isFinite(endMs)) {
      return { accepted: false, reason: 'invalid-cumulative' };
    }

    const prev = this.lastCumulative.get(meterKey);
    const delta = cumulativeDelta(prev?.wh ?? null, wh, prev?.epoch ?? epoch, epoch);
    this.lastCumulative.set(meterKey, { wh, epoch, endMs });

    if (delta.unknown) {
      const gapStart = prev?.endMs ?? endMs;
      const gapMs = Math.max(0, endMs - gapStart);
      return this.commit({
        sampleId: reading.sampleId || `cum-unknown:${meterKey}:${endMs}:${delta.event}`,
        source,
        scope,
        quality: 'unknown',
        unit: 'Wh',
        value: null,
        startMs: gapStart,
        endMs,
        utcMs,
        meterEpoch: epoch,
        unknownReason: delta.event,
        sessionId: reading.sessionId,
        profileId: reading.profileId
      });
    }

    const startMs = prev.endMs;
    // Continuous cumulative meters: the Wh delta is authoritative for [start,end].
    // Do not also mark the same window as unknownCoverage when poll interval > maxGapMs.
    return this.commit({
      sampleId: reading.sampleId || `cum:${meterKey}:${startMs}:${endMs}`,
      source,
      scope,
      quality: reading.quality || 'measured',
      unit: 'Wh',
      value: delta.deltaWh,
      wattHours: delta.deltaWh,
      startMs,
      endMs,
      utcMs,
      meterEpoch: epoch,
      sessionId: reading.sessionId,
      profileId: reading.profileId,
      includesDisplay: reading.includesDisplay === true,
      includesChargingLoad: reading.includesChargingLoad === true
    });
  }

  /**
   * Integrate a stream of W samples with gap detection (no unlimited extrapolation).
   * @param {object[]} wattSamples sorted by time: {watts, atMs, source, scope, quality, ...}
   */
  commitWattSeries(wattSamples = [], opts = {}) {
    const results = [];
    const maxGap = opts.maxGapMs ?? this.maxGapMs;
    let prev = null;
    for (const s of wattSamples) {
      if (prev) {
        const wallDt = s.atMs - prev.atMs;
        const monoPrev = prev.monotonicMs != null ? prev.monotonicMs : prev.atMs;
        const monoNext = s.monotonicMs != null ? s.monotonicMs : s.atMs;
        const monoDt = monoNext - monoPrev;
        // Prefer monotonic for gap/OOO when both present (sleep / NTP safe).
        const dt = Number.isFinite(monoDt) ? monoDt : wallDt;
        if (dt < 0) {
          results.push({ accepted: false, reason: 'out-of-order' });
          continue;
        }
        if (dt > maxGap) {
          results.push(
            this.commit({
              sampleId: `gap:${prev.atMs}:${s.atMs}`,
              source: s.source || prev.source || 'series',
              scope: s.scope || prev.scope || 'manual',
              quality: 'unknown',
              unit: 'W',
              value: null,
              startMs: prev.atMs,
              endMs: s.atMs,
              utcMs: s.atMs,
              unknownReason: 'missing-interval'
            })
          );
          prev = s;
          continue;
        }
        // Trapezoid: average power over interval (use wall duration for energy)
        const energyDt = wallDt >= 0 ? wallDt : dt;
        const avgW = (prev.watts + s.watts) / 2;
        results.push(
          this.commit({
            sampleId: s.sampleId || `w:${prev.atMs}:${s.atMs}`,
            source: s.source || 'series',
            scope: s.scope || 'manual',
            quality: s.quality || prev.quality || 'estimated',
            unit: 'W',
            value: avgW,
            startMs: prev.atMs,
            endMs: prev.atMs + energyDt,
            utcMs: s.atMs,
            monotonicMs: monoNext,
            meterEpoch: s.meterEpoch,
            sessionId: s.sessionId,
            profileId: s.profileId,
            includesDisplay: s.includesDisplay,
            includesChargingLoad: s.includesChargingLoad
          })
        );
      }
      prev = s;
    }
    return results;
  }

  /**
   * Total device energy for billable scopes (wall preferred; never sum wall+usb+cpu).
   * @param {EnergyScope[]} [prefer]
   */
  deviceWattHours(prefer = ['wall', 'usb', 'manual']) {
    for (const scope of prefer) {
      if (this.committedWhByScope[scope] != null) {
        return {
          wattHours: this.committedWhByScope[scope],
          scope,
          quality: this.qualityByScope[scope] || (scope === 'manual' ? 'manual' : 'unknown'),
          unknown: false
        };
      }
    }
    return { wattHours: null, scope: null, quality: 'unknown', unknown: true };
  }

  /**
   * @returns {object}
   */
  snapshot() {
    const device = this.deviceWattHours();
    const totalKnownMs = this.knownCoverageMs;
    const totalUnknownMs = this.unknownCoverageMs;
    const coverageRatio =
      totalKnownMs + totalUnknownMs > 0
        ? totalKnownMs / (totalKnownMs + totalUnknownMs)
        : null;
    return {
      schemaVersion: this.schemaVersion,
      byScopeWh: { ...this.committedWhByScope },
      deviceWh: device.wattHours,
      deviceScope: device.scope,
      deviceQuality: device.quality,
      knownCoverageMs: totalKnownMs,
      unknownCoverageMs: totalUnknownMs,
      coverageRatio,
      entryCount: this.entries.size
    };
  }

  /**
   * Export entries in [fromMs, toMs] for recomputation.
   */
  exportRange(fromMs, toMs) {
    return [...this.entries.values()].filter(
      (e) => e.endMs >= fromMs && e.startMs <= toMs
    );
  }

  /**
   * Serialize durable meter cursors for relaunch.
   */
  exportState() {
    return {
      entries: [...this.entries.values()],
      lastCumulative: Object.fromEntries(this.lastCumulative.entries()),
      maxGapMs: this.maxGapMs
    };
  }

  /**
   * Recompute totals from exported entries (dedupe by sampleId).
   * @param {object[]} entries
   * @param {object} [opts]
   * @param {Record<string,{wh:number,epoch:string,endMs:number}>} [opts.lastCumulative]
   */
  static fromEntries(entries = [], opts = {}) {
    const ledger = new EnergyLedger(opts);
    for (const e of entries) {
      ledger.commit(e);
    }
    if (opts.lastCumulative) {
      for (const [k, v] of Object.entries(opts.lastCumulative)) {
        if (v && Number.isFinite(v.wh) && v.epoch != null && Number.isFinite(v.endMs)) {
          ledger.lastCumulative.set(k, { wh: v.wh, epoch: String(v.epoch), endMs: v.endMs });
        }
      }
    }
    return ledger;
  }

  static fromState(state = {}) {
    return EnergyLedger.fromEntries(state.entries || [], {
      maxGapMs: state.maxGapMs,
      lastCumulative: state.lastCumulative || {}
    });
  }
}

/**
 * Incremental (mining-attributable) energy vs a counterfactual baseline.
 * Negative increments are flagged as noise — never "free generation".
 *
 * @param {object} input
 * @param {number|null} input.deviceWh
 * @param {number|null} input.baselineWh
 * @param {BaselineMode} input.baselineMode
 * @param {boolean} [input.baselineTrusted]
 */
export function calibrateIncremental(input = {}) {
  const deviceWh = input.deviceWh;
  const baselineWh = input.baselineWh;
  const baselineMode = input.baselineMode || 'off';
  const baselineTrusted = input.baselineTrusted !== false;

  if (deviceWh == null || !Number.isFinite(deviceWh)) {
    return {
      deviceWh: null,
      baselineWh: null,
      incrementalWh: null,
      baselineMode,
      quality: 'unknown',
      note: 'device-energy-unknown'
    };
  }

  // Device would have been off → full device energy is incremental
  if (baselineMode === 'off') {
    return {
      deviceWh,
      baselineWh: 0,
      incrementalWh: deviceWh,
      baselineMode,
      quality: 'estimated',
      note: 'baseline-off-no-standby-deduction'
    };
  }

  if (!baselineTrusted || baselineWh == null || !Number.isFinite(baselineWh)) {
    return {
      deviceWh,
      baselineWh: null,
      incrementalWh: null,
      baselineMode,
      quality: 'unknown',
      note: 'baseline-untrusted-or-missing'
    };
  }

  const incrementalWh = deviceWh - baselineWh;
  if (incrementalWh < 0) {
    return {
      deviceWh,
      baselineWh,
      incrementalWh: null,
      baselineMode,
      quality: 'unknown',
      note: 'negative-incremental-treated-as-noise'
    };
  }

  return {
    deviceWh,
    baselineWh,
    incrementalWh,
    baselineMode,
    quality: 'estimated',
    note: null
  };
}

/**
 * Shared-socket attribution: count wall meter once across miners.
 * @param {number|null} wallWh
 * @param {string[]} minerIds
 * @param {'shared_total'|'equal_split'|'none'} mode
 */
export function attributeSharedMeter(wallWh, minerIds = [], mode = 'shared_total') {
  if (wallWh == null || !Number.isFinite(wallWh)) {
    return { mode, totalWh: null, perMiner: {}, note: 'unknown-meter' };
  }
  if (mode === 'none' || minerIds.length === 0) {
    return { mode, totalWh: wallWh, perMiner: {}, note: 'unattributed-shared-total' };
  }
  if (mode === 'equal_split' && minerIds.length > 0) {
    const each = wallWh / minerIds.length;
    const perMiner = Object.fromEntries(minerIds.map((id) => [id, each]));
    return {
      mode,
      totalWh: wallWh,
      perMiner,
      note: 'equal-split-estimate-not-precision'
    };
  }
  // shared_total: show once, do not invent per-miner
  return {
    mode: 'shared_total',
    totalWh: wallWh,
    perMiner: {},
    note: 'shared-socket-counted-once'
  };
}
