/**
 * Economy snapshot / accrual ledger (#72).
 */

export const SCHEMA_VERSION = 1;

/**
 * @typedef {'expected_gross'|'credited'|'paid'} AccrualKind
 */

/**
 * Deduplicate payout records: paid amounts already in credited must not be added again
 * when computing "realized" totals.
 * @param {object} input
 * @param {number|null} [input.expectedGross]
 * @param {number|null} [input.credited]
 * @param {number|null} [input.paid]
 * @param {boolean} [input.poolFeeAlreadyDeducted]
 * @param {number|null} [input.developerFeeNative] additional fee to subtract if not in pool balance
 * @param {number|null} [input.energyCostFiat]
 * @param {number|null} [input.marketRate] fiat per native coin
 * @param {string|null} [input.marketRateSource]
 * @param {number|null} [input.marketRateAtMs]
 * @param {boolean} [input.marketRateExpired]
 */
export function buildEconomySnapshot(input = {}) {
  const expectedGross = finiteOrNull(input.expectedGross);
  const credited = finiteOrNull(input.credited);
  const paid = finiteOrNull(input.paid);

  // paid ⊆ credited conceptually — unpaid = credited - paid when both known
  let unpaid = null;
  if (credited != null && paid != null) {
    unpaid = Math.max(0, credited - paid);
  }

  // Choose valuation base: prefer credited, else expected; never sum paid+credited
  let nativeForValue = null;
  let valueLayer = null;
  if (credited != null) {
    nativeForValue = credited;
    valueLayer = 'credited';
  } else if (expectedGross != null) {
    nativeForValue = expectedGross;
    valueLayer = 'expected_gross';
  }

  let feeNative = 0;
  if (input.poolFeeAlreadyDeducted) {
    feeNative = 0;
  } else if (finiteOrNull(input.developerFeeNative) != null) {
    feeNative = input.developerFeeNative;
  }

  const netNative =
    nativeForValue == null ? null : Math.max(0, nativeForValue - feeNative);

  const rate = finiteOrNull(input.marketRate);
  const rateOk = rate != null && input.marketRateExpired !== true;
  const fiatGross =
    netNative != null && rateOk ? netNative * rate : null;

  const energyCost = finiteOrNull(input.energyCostFiat);
  let netFiat = null;
  let netQuality = 'unknown';
  if (fiatGross != null && energyCost != null) {
    netFiat = fiatGross - energyCost;
    netQuality = 'estimated';
  } else if (fiatGross == null && energyCost != null) {
    // Cost known, revenue unknown — do NOT invent 0 profit
    netFiat = null;
    netQuality = 'unknown';
  } else if (fiatGross != null && energyCost == null) {
    netFiat = null;
    netQuality = 'unknown';
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    expectedGross,
    credited,
    paid,
    unpaid,
    valueLayer,
    netNative,
    feeNative,
    poolFeeAlreadyDeducted: input.poolFeeAlreadyDeducted === true,
    marketRate: rate,
    marketRateSource: input.marketRateSource || null,
    marketRateAtMs: input.marketRateAtMs ?? null,
    marketRateExpired: input.marketRateExpired === true,
    fiatGross,
    energyCostFiat: energyCost,
    netFiat,
    netQuality,
    profitable:
      netFiat == null || netQuality === 'unknown' ? null : netFiat > 0
  };
}

function finiteOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Shared-wallet pool balance: count once across device IDs.
 * @param {{walletId:string, balance:number}[]} balances
 */
export function dedupeWalletBalances(balances = []) {
  const byWallet = new Map();
  for (const b of balances) {
    if (!b || !b.walletId) continue;
    const bal = finiteOrNull(b.balance);
    if (bal == null) continue;
    // Same wallet → keep max observed (not sum)
    const prev = byWallet.get(b.walletId);
    byWallet.set(b.walletId, prev == null ? bal : Math.max(prev, bal));
  }
  let total = 0;
  for (const v of byWallet.values()) total += v;
  return { byWallet: Object.fromEntries(byWallet), total, wallets: byWallet.size };
}

/**
 * Accrual ledger with idempotent payout records.
 */
export class AccrualLedger {
  constructor() {
    /** @type {Map<string, object>} */
    this.records = new Map();
  }

  /**
   * @param {object} rec
   * @param {string} rec.id
   * @param {AccrualKind} rec.kind
   * @param {number} rec.amountNative
   * @param {string} [rec.walletId]
   * @param {string} [rec.poolId]
   */
  commit(rec) {
    if (!rec?.id) return { accepted: false, reason: 'missing-id' };
    if (this.records.has(rec.id)) return { accepted: false, reason: 'duplicate' };
    const amount = finiteOrNull(rec.amountNative);
    if (amount == null) return { accepted: false, reason: 'invalid-amount' };
    if (!['expected_gross', 'credited', 'paid'].includes(rec.kind)) {
      return { accepted: false, reason: 'invalid-kind' };
    }
    this.records.set(rec.id, { ...rec, amountNative: amount });
    return { accepted: true };
  }

  totals() {
    let expectedGross = 0;
    let credited = 0;
    let paid = 0;
    let hasExpected = false;
    let hasCredited = false;
    let hasPaid = false;
    for (const r of this.records.values()) {
      if (r.kind === 'expected_gross') {
        expectedGross += r.amountNative;
        hasExpected = true;
      } else if (r.kind === 'credited') {
        credited += r.amountNative;
        hasCredited = true;
      } else if (r.kind === 'paid') {
        paid += r.amountNative;
        hasPaid = true;
      }
    }
    return {
      expectedGross: hasExpected ? expectedGross : null,
      credited: hasCredited ? credited : null,
      paid: hasPaid ? paid : null
    };
  }

  snapshot(extra = {}) {
    const t = this.totals();
    return buildEconomySnapshot({ ...t, ...extra });
  }
}

/**
 * Escape CSV cell against formula injection.
 * @param {string|number|null|undefined} value
 */
export function csvSafe(value) {
  if (value == null) return '';
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Morning/session summary lines (no push by default).
 */
export function formatSessionSummary(snap, meta = {}) {
  const lines = [];
  lines.push(`Mined window: ${meta.elapsedLabel || 'unknown'}`);
  lines.push(`Pause reasons: ${(meta.pauseReasons || []).join(', ') || 'none'}`);
  lines.push(
    `Energy: ${snap.energyCostFiat == null ? 'unknown' : snap.energyCostFiat}`
  );
  lines.push(
    `Credited: ${snap.credited == null ? 'unknown' : snap.credited}; Paid: ${snap.paid == null ? 'unknown' : snap.paid}`
  );
  if (snap.netQuality === 'unknown') {
    lines.push('Net: unknown (incomplete revenue or cost)');
  } else {
    lines.push(`Net fiat: ${snap.netFiat}`);
  }
  return lines.join('\n');
}
