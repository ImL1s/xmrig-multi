/**
 * Automation policy reducer (#73).
 */

export const SCHEMA_VERSION = 1;

/** @typedef {'efficiency'|'profit_only'|'hobby'} EconomicGoal */

export const DEFAULTS = Object.freeze({
  economicGoal: /** @type {EconomicGoal} */ ('hobby'),
  dailySpendCapFiat: null,
  monthlySpendCapFiat: null,
  dailyKwhCap: null,
  sessionMaxMs: null,
  minReserveSocPercent: null,
  spendBasis: 'gross_spend', // never net-of-unknown-revenue
  stopReserveSampleMs: 60_000,
  hysteresisMs: 5 * 60_000
});

/**
 * @typedef {object} AutomationIntent
 * @property {boolean} automationArmed
 * @property {number} userStopRevision
 * @property {number} sessionArmedRevision
 * @property {boolean} [pauseUntilNextPlug]
 */

/**
 * @param {object} input
 */
export function evaluateAutomation(input = {}) {
  const cfg = { ...DEFAULTS, ...(input.config || {}) };
  const nowMs = input.nowMs ?? Date.now();
  const intent = {
    automationArmed: false,
    userStopRevision: 0,
    sessionArmedRevision: 0,
    pauseUntilNextPlug: false,
    ...(input.intent || {})
  };
  const power = input.power || { kind: 'Allowed' };
  const thermal = input.thermal || { kind: 'Allowed' };
  const os = input.os || { coldStartAllowed: true, reasons: [] };
  const budget = normalizeBudget(input.budget || {}, cfg, nowMs);
  const economy = input.economy || { netFiat: null, netQuality: 'unknown' };

  const reasons = [];

  if (intent.userStopRevision > intent.sessionArmedRevision) {
    return verdict('UserStopped', [
      'Manual Stop latched — plug/cool-down/budget reset cannot revive'
    ], intent, 'pause');
  }

  if (!intent.automationArmed && !input.manualStart) {
    return verdict('Waiting', ['Automation not armed — explicit enable required'], intent, 'wait');
  }

  if (os.coldStartAllowed === false) {
    return verdict(
      'Unavailable',
      os.reasons?.length ? os.reasons : ['OS cold start not permitted'],
      intent,
      'unavailable'
    );
  }

  if (thermal.kind === 'Paused' || thermal.kind === 'Unavailable') {
    return verdict('Paused', thermal.reasons || ['Thermal block'], intent, 'pause');
  }

  if (power.kind === 'UserStopped') {
    return verdict('UserStopped', power.reasons || ['Power Stop'], intent, 'pause');
  }
  if (power.kind === 'Paused' || power.kind === 'Waiting' || power.kind === 'Unavailable') {
    return verdict(power.kind, power.reasons || ['Power policy'], intent, mapAction(power.kind));
  }

  if (intent.pauseUntilNextPlug) {
    return verdict('Waiting', ['Paused until next plug (explicit re-auth)'], intent, 'wait');
  }

  // Budget — gross spend basis (do not unlock via unknown revenue)
  const budgetHit = evaluateBudget(budget, cfg);
  if (budgetHit) {
    return verdict('Paused', [budgetHit], intent, 'pause');
  }

  // Economic goal
  if (cfg.economicGoal === 'profit_only') {
    if (economy.netQuality === 'unknown' || economy.netFiat == null) {
      return verdict(
        'Waiting',
        ['Profit-only: net estimate unknown — will not assume profitable'],
        intent,
        'wait'
      );
    }
    if (economy.netFiat <= 0) {
      return verdict(
        'Paused',
        [`Profit-only: estimated net ${economy.netFiat} ≤ 0`],
        intent,
        'pause'
      );
    }
  }
  // hobby: may run at negative estimate while budget remains

  if (cfg.economicGoal === 'efficiency' && economy.netQuality === 'unknown') {
    reasons.push('Efficiency mode: incomplete economy data — proceeding under budget/safety only');
  }

  return verdict('Allowed', reasons.length ? reasons : ['All automation gates passed'], intent, 'none');
}

function evaluateBudget(budget, cfg) {
  if (cfg.dailySpendCapFiat != null && budget.spentFiatToday != null) {
    const reserve = estimateReserve(cfg);
    if (budget.spentFiatToday + reserve > cfg.dailySpendCapFiat) {
      return `Daily spend cap reached (spent ${budget.spentFiatToday}, reserve ${reserve})`;
    }
  }
  if (cfg.monthlySpendCapFiat != null && budget.spentFiatMonth != null) {
    if (budget.spentFiatMonth >= cfg.monthlySpendCapFiat) {
      return `Monthly spend cap reached (${budget.spentFiatMonth})`;
    }
  }
  if (cfg.dailyKwhCap != null && budget.kwhToday != null) {
    if (budget.kwhToday >= cfg.dailyKwhCap) {
      return `Daily kWh cap reached (${budget.kwhToday})`;
    }
  }
  if (cfg.sessionMaxMs != null && budget.sessionElapsedMs != null) {
    if (budget.sessionElapsedMs >= cfg.sessionMaxMs) {
      return `Session time cap reached`;
    }
  }
  if (cfg.minReserveSocPercent != null && budget.socPercent != null) {
    if (budget.socPercent < cfg.minReserveSocPercent) {
      return `Battery reserve ${budget.socPercent}% < ${cfg.minReserveSocPercent}%`;
    }
  }
  return null;
}

function estimateReserve(cfg) {
  // Conservative next-sample reserve in fiat if provided via budget.projectedNextSampleFiat
  return 0;
}

function normalizeBudget(b, cfg, nowMs) {
  return {
    spentFiatToday: num(b.spentFiatToday),
    spentFiatMonth: num(b.spentFiatMonth),
    kwhToday: num(b.kwhToday),
    sessionElapsedMs: num(b.sessionElapsedMs),
    socPercent: num(b.socPercent),
    dayKey: b.dayKey || null,
    monthKey: b.monthKey || null,
    nowMs
  };
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function mapAction(kind) {
  if (kind === 'Paused') return 'pause';
  if (kind === 'Waiting') return 'wait';
  if (kind === 'Unavailable') return 'unavailable';
  return 'none';
}

function verdict(kind, reasons, intent, suggestedAction) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind,
    reasons,
    suggestedAction,
    preservesSessionData: true,
    nextIntent: intent,
    startsMiner: false // evaluate never starts; controller decides
  };
}

/**
 * Dry-run what-if scenarios with the same predicate.
 */
export function simulate(baseInput, scenario = {}) {
  const observation = {
    ...baseInput,
    power: scenario.power || baseInput.power,
    thermal: scenario.thermal || baseInput.thermal,
    budget: { ...(baseInput.budget || {}), ...(scenario.budget || {}) },
    economy: { ...(baseInput.economy || {}), ...(scenario.economy || {}) },
    os: scenario.os || baseInput.os,
    intent: { ...(baseInput.intent || {}), ...(scenario.intent || {}) },
    nowMs: scenario.nowMs ?? baseInput.nowMs
  };
  const v = evaluateAutomation(observation);
  return { ...v, simulated: true, scenarioLabel: scenario.label || 'what-if' };
}

export function latchUserStop(intent) {
  return {
    ...intent,
    userStopRevision: (intent.userStopRevision || 0) + 1,
    automationArmed: false,
    pauseUntilNextPlug: false
  };
}

export function armAutomation(intent) {
  return {
    ...intent,
    sessionArmedRevision: intent.userStopRevision || 0,
    automationArmed: true,
    pauseUntilNextPlug: false
  };
}

export function pauseUntilNextPlug(intent) {
  return { ...intent, pauseUntilNextPlug: true };
}
