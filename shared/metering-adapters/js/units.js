/**
 * Energy unit helpers (#81).
 * Case-sensitive for mWh vs MWh (toLowerCase would collide).
 */

/**
 * @param {unknown} value
 * @param {string} unit
 */
export function normalizePowerOrEnergy(value, unit) {
  if (value === null || value === undefined || value === 'unavailable' || value === 'unknown') {
    return { ok: false, kind: 'unknown', reason: String(value ?? 'null') };
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return { ok: false, kind: 'unknown', reason: 'non-numeric' };
  }

  // Exact tokens first — never fold case (mWh ≠ MWh).
  const raw = String(unit || '').trim();
  if (raw === 'W' || raw === 'watt' || raw === 'watts') {
    return { ok: true, kind: 'power_w', watts: n };
  }
  if (raw === 'kW') {
    return { ok: true, kind: 'power_w', watts: n * 1000 };
  }
  if (raw === 'Wh') {
    return { ok: true, kind: 'energy_wh', wattHours: n };
  }
  if (raw === 'mWh') {
    return { ok: true, kind: 'energy_wh', wattHours: n / 1000 };
  }
  if (raw === 'kWh') {
    return { ok: true, kind: 'energy_wh', wattHours: n * 1000 };
  }
  if (raw === 'MWh') {
    return { ok: true, kind: 'energy_wh', wattHours: n * 1_000_000 };
  }

  // HA sometimes emits lowercase; allow unambiguous lowercase only (not "mwh").
  const lower = raw.toLowerCase();
  if (lower === 'w') {
    return { ok: true, kind: 'power_w', watts: n };
  }
  if (lower === 'kw') {
    return { ok: true, kind: 'power_w', watts: n * 1000 };
  }
  if (lower === 'wh') {
    return { ok: true, kind: 'energy_wh', wattHours: n };
  }
  if (lower === 'kwh') {
    return { ok: true, kind: 'energy_wh', wattHours: n * 1000 };
  }
  if (lower === 'mwh') {
    return {
      ok: false,
      kind: 'ambiguous_unit',
      reason: 'Ambiguous unit "mwh" — use mWh (milliwatt-hours) or MWh (megawatt-hours)'
    };
  }

  return { ok: false, kind: 'unsupported_unit', reason: `unit ${unit}` };
}
