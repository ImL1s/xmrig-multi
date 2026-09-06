/**
 * Multi-device aggregation (#80).
 */

/**
 * @param {object[]} devices
 * @param {object} [opts]
 */
export function aggregateBoard(devices = [], opts = {}) {
  /** @type {Record<string, number>} */
  const hashrateByAlgo = {};
  /** @type {Set<string>} */
  const meterIds = new Set();
  /** @type {Set<string>} */
  const walletKeys = new Set();
  let powerW = 0;
  let powerUnknown = false;
  let costFiat = 0;
  let costUnknown = false;
  let creditedFiat = 0;
  const cards = [];

  for (const d of devices) {
    const algo = String(d.algorithm || 'unknown');
    const hs = Number(d.hashrateHs);
    if (Number.isFinite(hs) && d.showHashrate !== false) {
      hashrateByAlgo[algo] = (hashrateByAlgo[algo] || 0) + hs;
    }

    if (d.meterId) {
      if (!meterIds.has(d.meterId)) {
        meterIds.add(d.meterId);
        if (d.powerW == null || !Number.isFinite(Number(d.powerW))) powerUnknown = true;
        else powerW += Number(d.powerW);
        if (d.costFiat == null || !Number.isFinite(Number(d.costFiat))) costUnknown = true;
        else costFiat += Number(d.costFiat);
      }
    } else if (d.powerW != null && Number.isFinite(Number(d.powerW))) {
      powerW += Number(d.powerW);
    } else if (d.includePower !== false) {
      powerUnknown = true;
    }

    const walletKey =
      d.walletId && d.poolId ? `${d.walletId}::${d.poolId}` : d.walletId || null;
    if (walletKey) {
      if (!walletKeys.has(walletKey)) {
        walletKeys.add(walletKey);
        if (Number.isFinite(Number(d.creditedFiat))) creditedFiat += Number(d.creditedFiat);
      }
    }

    cards.push({
      deviceId: d.deviceId,
      status: d.status || 'unknown',
      algorithm: algo,
      hashrateHs: Number.isFinite(hs) ? hs : null,
      freshness: d.freshness || 'offline',
      lastUpdatedAtMs: d.lastUpdatedAtMs ?? null,
      sessionId: d.sessionId ?? null
    });
  }

  return {
    hashrateByAlgo,
    powerW: powerUnknown && powerW === 0 ? null : powerW,
    powerQuality: powerUnknown ? 'unknown' : 'measured',
    costFiat: costUnknown && costFiat === 0 ? null : costFiat,
    costQuality: costUnknown ? 'unknown' : 'estimated',
    creditedFiat,
    assumptions: opts.assumptions || [],
    cards,
    meterCount: meterIds.size,
    walletPoolKeys: [...walletKeys]
  };
}
