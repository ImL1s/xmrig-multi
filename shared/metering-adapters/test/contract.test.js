/**
 * Metering adapter contract tests (#81).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizePowerOrEnergy } from '../js/units.js';
import { parseShellyStatus, shellyAssertReadOnly } from '../js/shelly.js';
import { parseHaEntity, presentHaTransportError } from '../js/homeAssistant.js';
import {
  attributeSharedMeters,
  resolveBudgetAction,
  interpretOptionalTariffHint
} from '../js/policy.js';

const dir = dirname(fileURLToPath(import.meta.url));
const fix = (name) => JSON.parse(readFileSync(join(dir, '..', 'fixtures', name), 'utf8'));

test('units: W / Wh / mWh / unknown', () => {
  assert.equal(normalizePowerOrEnergy(10, 'W').watts, 10);
  assert.equal(normalizePowerOrEnergy(1000, 'mWh').wattHours, 1);
  assert.equal(normalizePowerOrEnergy('unavailable', 'W').ok, false);
});

test('shelly metered vs relay-only; writes forbidden', () => {
  const metered = parseShellyStatus(fix('shelly-switch-metered.json'), {
    minuteUnit: 'mWh'
  });
  assert.equal(metered.ok, true);
  assert.equal(metered.powerW, 123.4);
  assert.equal(metered.energyWhTotal, 12.5);
  assert.ok(metered.minuteSamplesWh.length === 3);

  const relay = parseShellyStatus(fix('shelly-relay-only.json'));
  assert.equal(relay.capability, 'unsupported');

  assert.equal(shellyAssertReadOnly('Switch.Set').ok, false);
  assert.equal(shellyAssertReadOnly('Switch.GetStatus').ok, true);
});

test('HA entity unavailable and TLS/auth errors surface', () => {
  const bad = parseHaEntity(fix('ha-unavailable.json'));
  assert.equal(bad.ok, false);
  const good = parseHaEntity(fix('ha-power.json'));
  assert.equal(good.powerW, 85.2);
  assert.match(good.tokenCapabilityWarning, /token/i);
  assert.equal(presentHaTransportError({ tlsError: true }).code, 'tls');
  assert.equal(presentHaTransportError({ status: 401 }).code, 'auth');
});

test('shared meter counted once; no invented splits', () => {
  const { meters } = attributeSharedMeters([
    { meterId: 'm1', deviceId: 'a', powerW: 100 },
    { meterId: 'm1', deviceId: 'b', powerW: 100 }
  ]);
  assert.equal(meters.length, 1);
  assert.equal(meters[0].powerW, 100);
  assert.equal(meters[0].perDevicePowerW, null);
  assert.equal(meters[0].shared, true);
});

test('budget never hard-cuts power; solar not free mining', () => {
  const a = resolveBudgetAction({ overBudget: true });
  assert.equal(a.allowSwitchWrite, false);
  assert.equal(a.action, 'stop_miner_via_controller');
  const s = interpretOptionalTariffHint({ solarSurplusW: 500 });
  assert.equal(s.mayMine, false);
});
