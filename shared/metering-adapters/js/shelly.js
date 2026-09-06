/**
 * Shelly Gen2 Switch / PM1 sample adapter (#81).
 * @see https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Switch/
 */

import { normalizePowerOrEnergy } from './units.js';

const WRITE_METHODS = new Set([
  'Switch.Set',
  'Switch.Toggle',
  'Switch.ResetCounters',
  'PM1.ResetCounters',
  'Shelly.SetConfig'
]);

/**
 * Parse a Switch.GetStatus / PM1.GetStatus-like object.
 * @param {object} status
 * @param {object} [meta]
 */
export function parseShellyStatus(status = {}, meta = {}) {
  const hasMeter = status.apower != null || status.aenergy != null;
  if (!hasMeter) {
    return {
      ok: false,
      adapter: 'shelly',
      reason: 'Device has no metering (relay-only) — unsupported as energy source',
      capability: 'unsupported'
    };
  }

  const power = normalizePowerOrEnergy(status.apower, 'W');
  const energyTotal = status.aenergy?.total;
  // Shelly docs: aenergy.total is Wh; some minute samples use mWh in by_minute arrays.
  const energy = normalizePowerOrEnergy(energyTotal, meta.energyUnit || 'Wh');
  const minuteSamples = Array.isArray(status.aenergy?.by_minute)
    ? status.aenergy.by_minute.map((v) => normalizePowerOrEnergy(v, meta.minuteUnit || 'mWh'))
    : [];

  return {
    ok: power.ok || energy.ok,
    adapter: 'shelly',
    capability: 'metering',
    sampledAtMs: meta.sampledAtMs ?? Date.now(),
    powerW: power.ok ? power.watts : null,
    energyWhTotal: energy.ok ? energy.wattHours : null,
    minuteSamplesWh: minuteSamples.filter((s) => s.ok).map((s) => s.wattHours),
    output: typeof status.output === 'boolean' ? status.output : null,
    energyDirection: meta.energyDirection || 'unknown',
    writeMethodsForbidden: [...WRITE_METHODS]
  };
}

/**
 * Build allowed RPC allowlist — GET-like status only.
 */
export function shellyAllowedMethods() {
  return Object.freeze(['Switch.GetStatus', 'PM1.GetStatus', 'Shelly.GetDeviceInfo']);
}

export function shellyAssertReadOnly(method) {
  if (WRITE_METHODS.has(method)) {
    return { ok: false, reason: `Write method ${method} forbidden by metering adapter` };
  }
  if (!shellyAllowedMethods().includes(method)) {
    return { ok: false, reason: `Method ${method} not in read allowlist` };
  }
  return { ok: true, reason: 'read-only allowed' };
}
