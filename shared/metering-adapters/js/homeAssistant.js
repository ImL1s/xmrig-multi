/**
 * Home Assistant REST entity adapter (#81).
 */

import { normalizePowerOrEnergy } from './units.js';

/**
 * @param {object} entity HA /api/states/<entity_id> shape
 * @param {object} [meta]
 */
export function parseHaEntity(entity = {}, meta = {}) {
  const state = entity.state;
  if (state === 'unavailable' || state === 'unknown') {
    return {
      ok: false,
      adapter: 'home_assistant',
      reason: `Entity ${entity.entity_id || '?'} is ${state}`,
      quality: state
    };
  }

  const unit =
    meta.unit ||
    entity.attributes?.unit_of_measurement ||
    entity.attributes?.native_unit_of_measurement ||
    '';
  const deviceClass = entity.attributes?.device_class || meta.deviceClass || '';
  const normalized = normalizePowerOrEnergy(state, unit);

  if (!normalized.ok) {
    return {
      ok: false,
      adapter: 'home_assistant',
      reason: normalized.reason,
      quality: 'unknown'
    };
  }

  const isPower = deviceClass === 'power' || normalized.kind === 'power_w';
  const isEnergy = deviceClass === 'energy' || normalized.kind === 'energy_wh';

  return {
    ok: true,
    adapter: 'home_assistant',
    entityId: entity.entity_id || null,
    sampledAtMs: entity.last_updated
      ? Date.parse(entity.last_updated)
      : meta.sampledAtMs ?? Date.now(),
    powerW: isPower ? normalized.watts : null,
    energyWhTotal: isEnergy ? normalized.wattHours : null,
    quality: 'entity',
    // Bearer token may exceed read — disclose always
    tokenCapabilityWarning:
      'Home Assistant long-lived token may allow writes beyond this app’s GET usage — store revocably and disclose to the user'
  };
}

/**
 * TLS / auth failure presentation — never silent.
 */
export function presentHaTransportError(err = {}) {
  if (err.tlsError) {
    return { ok: false, fatal: true, reason: 'TLS error — not ignored', code: 'tls' };
  }
  if (err.status === 401 || err.status === 403) {
    return { ok: false, fatal: true, reason: 'Token invalid or revoked', code: 'auth' };
  }
  return { ok: false, fatal: false, reason: err.message || 'HA request failed', code: 'transport' };
}
