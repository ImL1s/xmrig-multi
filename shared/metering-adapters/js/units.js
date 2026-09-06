/**
 * Energy unit helpers (#81).
 */

/**
 * @param {unknown} value
 * @param {'W'|'Wh'|'mWh'|'kWh'|string} unit
 */
export function normalizePowerOrEnergy(value, unit) {
  if (value === null || value === undefined || value === 'unavailable' || value === 'unknown') {
    return { ok: false, kind: 'unknown', reason: String(value ?? 'null') };
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return { ok: false, kind: 'unknown', reason: 'non-numeric' };
  }
  const u = String(unit || '').toLowerCase();
  if (u === 'w' || u === 'watt' || u === 'watts') {
    return { ok: true, kind: 'power_w', watts: n };
  }
  if (u === 'kw') {
    return { ok: true, kind: 'power_w', watts: n * 1000 };
  }
  if (u === 'wh') {
    return { ok: true, kind: 'energy_wh', wattHours: n };
  }
  if (u === 'mwh') {
    return { ok: true, kind: 'energy_wh', wattHours: n / 1000 };
  }
  if (u === 'kwh') {
    return { ok: true, kind: 'energy_wh', wattHours: n * 1000 };
  }
  return { ok: false, kind: 'unsupported_unit', reason: `unit ${unit}` };
}
