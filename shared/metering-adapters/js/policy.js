/**
 * Metering policy (#81) — read-only, shared meter, no hard power cut.
 */

/**
 * Attribute samples to a shared meter without double-counting.
 * Prefer non-null readings when the first sample is empty; never sum.
 * @param {object[]} samples
 */
export function attributeSharedMeters(samples = []) {
  /** @type {Map<string, object>} */
  const byMeter = new Map();
  const orphans = [];

  for (const s of samples) {
    if (!s?.meterId) {
      orphans.push(s);
      continue;
    }
    if (!byMeter.has(s.meterId)) {
      byMeter.set(s.meterId, {
        meterId: s.meterId,
        powerW: s.powerW ?? null,
        energyWhTotal: s.energyWhTotal ?? null,
        deviceIds: [s.deviceId].filter(Boolean),
        shared: false
      });
    } else {
      const row = byMeter.get(s.meterId);
      row.shared = true;
      if (s.deviceId && !row.deviceIds.includes(s.deviceId)) row.deviceIds.push(s.deviceId);
      // Keep a single reading — fill nulls from later samples; never sum
      if (row.powerW == null && s.powerW != null) row.powerW = s.powerW;
      if (row.energyWhTotal == null && s.energyWhTotal != null) {
        row.energyWhTotal = s.energyWhTotal;
      }
    }
  }

  const meters = [...byMeter.values()].map((m) => ({
    ...m,
    perDevicePowerW: null, // never invent splits without a model
    note: m.shared
      ? 'Shared meter — showing total once, not per-miner precision'
      : 'Dedicated meter'
  }));

  return { meters, orphans };
}

/**
 * Budget overage must stop miner via controller — never Switch.Set.
 */
export function resolveBudgetAction(input = {}) {
  if (input.overBudget !== true) {
    return { action: 'none', allowSwitchWrite: false };
  }
  return {
    action: 'stop_miner_via_controller',
    allowSwitchWrite: false,
    reason: 'Budget exceeded — stop mining in software; do not hard-cut outlet power'
  };
}

/**
 * Solar / negative tariff must not imply free unlimited mining.
 */
export function interpretOptionalTariffHint(hint = {}) {
  if (hint.solarSurplusW != null && hint.solarSurplusW > 0) {
    return {
      mayMine: false,
      reason:
        'Solar surplus is optional policy input only — opportunity cost and data freshness required; not free unlimited mining'
    };
  }
  if (hint.negativePrice === true) {
    return {
      mayMine: false,
      reason: 'Negative tariff is not automatic free mining without user rate policy'
    };
  }
  return { mayMine: null, reason: 'no special tariff hint' };
}
