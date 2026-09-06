/**
 * Electricity tariff calculator (#71) — fixed / progressive / TOU.
 * Unknown rates stay null; explicit 0 / negative user rates are allowed.
 */

export const SCHEMA_VERSION = 1;

/**
 * @typedef {object} Tier
 * @property {number} upToKwh  exclusive upper bound; Infinity for last tier
 * @property {number} ratePerKwh
 */

/**
 * Progressive bill for total kWh under ascending tiers.
 * @param {number} kwh
 * @param {Tier[]} tiers sorted by upToKwh ascending
 * @returns {{ok:boolean, amount?:number, reason?:string, breakdown?:object[]}}
 */
export function billProgressive(kwh, tiers) {
  if (typeof kwh !== 'number' || !Number.isFinite(kwh) || kwh < 0) {
    return { ok: false, reason: 'invalid-kwh' };
  }
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return { ok: false, reason: 'no-tiers' };
  }
  let remaining = kwh;
  let prevCap = 0;
  let amount = 0;
  const breakdown = [];
  for (const tier of tiers) {
    if (typeof tier.ratePerKwh !== 'number' || !Number.isFinite(tier.ratePerKwh)) {
      return { ok: false, reason: 'unknown-rate' };
    }
    const cap = tier.upToKwh;
    const width = Number.isFinite(cap) ? Math.max(0, cap - prevCap) : remaining;
    const take = Math.min(remaining, width);
    if (take > 0) {
      amount += take * tier.ratePerKwh;
      breakdown.push({ fromKwh: prevCap, toKwh: prevCap + take, rate: tier.ratePerKwh, cost: take * tier.ratePerKwh });
      remaining -= take;
    }
    prevCap = Number.isFinite(cap) ? cap : prevCap + take;
    if (remaining <= 0) break;
  }
  if (remaining > 1e-12) {
    return { ok: false, reason: 'tiers-exhausted' };
  }
  return { ok: true, amount, breakdown };
}

/**
 * Marginal mining cost under progressive tariff.
 * @param {number} baseKwh household without mining
 * @param {number} miningKwh incremental mining energy
 * @param {Tier[]} tiers
 */
export function marginalProgressive(baseKwh, miningKwh, tiers) {
  if (typeof miningKwh !== 'number' || !Number.isFinite(miningKwh) || miningKwh < 0) {
    return { ok: false, reason: 'invalid-mining-kwh' };
  }
  const withMine = billProgressive(baseKwh + miningKwh, tiers);
  const base = billProgressive(baseKwh, tiers);
  if (!withMine.ok || !base.ok) {
    return { ok: false, reason: withMine.reason || base.reason };
  }
  return {
    ok: true,
    amount: withMine.amount - base.amount,
    billWithMining: withMine.amount,
    billBase: base.amount,
    method: 'counterfactual-progressive'
  };
}

/**
 * Fixed rate bill.
 * @param {number} kwh
 * @param {number|null|undefined} ratePerKwh
 */
export function billFixed(kwh, ratePerKwh) {
  if (typeof kwh !== 'number' || !Number.isFinite(kwh) || kwh < 0) {
    return { ok: false, reason: 'invalid-kwh' };
  }
  if (ratePerKwh == null || typeof ratePerKwh !== 'number' || !Number.isFinite(ratePerKwh)) {
    return { ok: false, reason: 'unknown-rate' };
  }
  return { ok: true, amount: kwh * ratePerKwh, method: 'fixed' };
}

/**
 * @typedef {object} TouPeriod
 * @property {string} id
 * @property {number} ratePerKwh
 * @property {number} startMinute  inclusive, 0–1439 local
 * @property {number} endMinute    exclusive; if <= start, wraps midnight
 * @property {number[]} [daysOfWeek] 0=Sun..6=Sat; omit = all days
 */

/**
 * Allocate energy samples across TOU periods.
 * @param {{startMs:number,endMs:number,kwh:number}[]} intervals
 * @param {TouPeriod[]} periods
 * @param {string} timeZone IANA tz for local minute/day
 * @param {(ms:number,tz:string)=>{minuteOfDay:number,dayOfWeek:number}} [clock]
 */
export function billTou(intervals, periods, timeZone = 'UTC', clock = defaultClock) {
  if (!Array.isArray(periods) || periods.length === 0) {
    return { ok: false, reason: 'no-periods' };
  }
  for (const p of periods) {
    if (typeof p.ratePerKwh !== 'number' || !Number.isFinite(p.ratePerKwh)) {
      return { ok: false, reason: 'unknown-rate', periodId: p.id };
    }
  }

  let amount = 0;
  let estimated = false;
  const byPeriod = Object.create(null);

  for (const iv of intervals || []) {
    if (typeof iv.kwh !== 'number' || !Number.isFinite(iv.kwh) || iv.kwh < 0) {
      return { ok: false, reason: 'invalid-kwh' };
    }
    if (!Number.isFinite(iv.startMs) || !Number.isFinite(iv.endMs) || iv.endMs < iv.startMs) {
      return { ok: false, reason: 'invalid-interval' };
    }
    const duration = iv.endMs - iv.startMs;
    if (duration === 0) {
      // instantaneous: price at start
      const c = clock(iv.startMs, timeZone);
      const period = matchPeriod(periods, c.minuteOfDay, c.dayOfWeek);
      if (!period) return { ok: false, reason: 'unmatched-tou' };
      amount += iv.kwh * period.ratePerKwh;
      byPeriod[period.id] = (byPeriod[period.id] || 0) + iv.kwh * period.ratePerKwh;
      continue;
    }

    // Minute-bucket allocation for cross-boundary intervals
    const startMin = Math.floor(iv.startMs / 60_000);
    const endMin = Math.ceil(iv.endMs / 60_000);
    const buckets = Math.max(1, endMin - startMin);
    if (buckets > 1) {
      // Time-split without per-bucket meter readings is an estimate
      estimated = true;
    }
    let assigned = 0;
    for (let b = 0; b < buckets; b++) {
      const bucketStart = (startMin + b) * 60_000;
      const bucketEnd = bucketStart + 60_000;
      const overlap = Math.max(0, Math.min(iv.endMs, bucketEnd) - Math.max(iv.startMs, bucketStart));
      if (overlap <= 0) continue;
      const share = overlap / duration;
      const kwhShare = iv.kwh * share;
      const mid = bucketStart + overlap / 2;
      const c = clock(mid, timeZone);
      const period = matchPeriod(periods, c.minuteOfDay, c.dayOfWeek);
      if (!period) return { ok: false, reason: 'unmatched-tou' };
      const cost = kwhShare * period.ratePerKwh;
      amount += cost;
      byPeriod[period.id] = (byPeriod[period.id] || 0) + cost;
      assigned += kwhShare;
    }
    if (Math.abs(assigned - iv.kwh) > 1e-9) {
      estimated = true;
    }
  }

  return {
    ok: true,
    amount,
    byPeriod,
    estimated,
    method: 'tou',
    timeZone
  };
}

function matchPeriod(periods, minuteOfDay, dayOfWeek) {
  for (const p of periods) {
    if (p.daysOfWeek && !p.daysOfWeek.includes(dayOfWeek)) continue;
    if (inMinuteWindow(minuteOfDay, p.startMinute, p.endMinute)) return p;
  }
  return null;
}

export function inMinuteWindow(minute, start, end) {
  if (start === end) return true; // all day
  if (start < end) return minute >= start && minute < end;
  return minute >= start || minute < end; // wraps midnight
}

function defaultClock(ms, timeZone) {
  // Use Intl for local fields
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday] ?? 0;
  return { minuteOfDay: hour * 60 + minute, dayOfWeek: wd };
}

/**
 * Round monetary amount at settlement (not per-second).
 * @param {number} amount
 * @param {number} [decimals=2]
 */
export function roundMoney(amount, decimals = 2) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  // Avoid binary float half-even surprises near .xx5
  const factor = 10 ** decimals;
  return Math.round((amount + Number.EPSILON) * factor) / factor;
}

/**
 * Unified entry: bill energy under a tariff descriptor.
 * @param {object} tariff
 * @param {object} input
 */
export function billEnergy(tariff, input = {}) {
  if (!tariff || !tariff.kind) return { ok: false, reason: 'no-tariff' };
  if (tariff.rateUnknown === true) return { ok: false, reason: 'unknown-rate' };

  switch (tariff.kind) {
    case 'fixed':
      return billFixed(input.kwh, tariff.ratePerKwh);
    case 'progressive': {
      if (input.mode === 'marginal') {
        if (typeof input.baseKwh !== 'number' || !Number.isFinite(input.baseKwh)) {
          return { ok: false, reason: 'invalid-base-kwh' };
        }
        return marginalProgressive(input.baseKwh, input.miningKwh ?? input.kwh ?? 0, tariff.tiers);
      }
      return billProgressive(input.kwh, tariff.tiers);
    }
    case 'tou':
      return billTou(input.intervals || [], tariff.periods, tariff.timeZone || 'UTC', input.clock);
    default:
      return { ok: false, reason: 'unsupported-kind' };
  }
}

export function marginalCost(tariff, baseKwh, miningKwh) {
  if (!tariff) return { ok: false, reason: 'no-tariff' };
  if (tariff.rateUnknown === true) return { ok: false, reason: 'unknown-rate' };
  if (tariff.kind === 'fixed') {
    const r = billFixed(miningKwh, tariff.ratePerKwh);
    return r.ok ? { ok: true, amount: r.amount, method: 'fixed-marginal' } : r;
  }
  if (tariff.kind === 'progressive') {
    return marginalProgressive(baseKwh, miningKwh, tariff.tiers);
  }
  return { ok: false, reason: 'marginal-not-defined-for-kind' };
}

/** Helpers to build tariff objects */
export function FixedTariff({ id = 'manual-fixed', currency = 'TWD', ratePerKwh, label = 'Manual fixed' }) {
  const unknown = ratePerKwh == null || !Number.isFinite(ratePerKwh);
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    kind: 'fixed',
    currency,
    label,
    ratePerKwh: unknown ? null : ratePerKwh,
    rateUnknown: unknown,
    verification: 'user-manual'
  };
}

export function ProgressiveTariff({
  id = 'manual-progressive',
  currency = 'TWD',
  tiers,
  label = 'Manual progressive',
  verification = 'user-manual',
  effectiveFrom = null
}) {
  const unknown =
    !Array.isArray(tiers) ||
    tiers.length === 0 ||
    tiers.some((t) => typeof t?.ratePerKwh !== 'number' || !Number.isFinite(t.ratePerKwh));
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    kind: 'progressive',
    currency,
    label,
    tiers,
    rateUnknown: unknown,
    verification,
    effectiveFrom
  };
}

export function TouTariff({
  id = 'manual-tou',
  currency = 'TWD',
  periods,
  timeZone = 'Asia/Taipei',
  label = 'Manual TOU',
  verification = 'user-manual',
  effectiveFrom = null
}) {
  const unknown =
    !Array.isArray(periods) ||
    periods.length === 0 ||
    periods.some((p) => typeof p?.ratePerKwh !== 'number' || !Number.isFinite(p.ratePerKwh));
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    kind: 'tou',
    currency,
    label,
    periods,
    timeZone,
    rateUnknown: unknown,
    verification,
    effectiveFrom
  };
}
