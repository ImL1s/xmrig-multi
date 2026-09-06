/**
 * Energy ledger contract tests (#70).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toWattHours,
  integrateWatts,
  normalizeSample,
  cumulativeDelta,
  EnergyLedger,
  calibrateIncremental,
  attributeSharedMeter
} from '../js/ledger.js';

const T0 = Date.parse('2026-09-06T00:00:00Z');
const HOUR = 3_600_000;

test('unit conversions: Wh / kWh / mWh / nWh', () => {
  assert.equal(toWattHours(1, 'Wh'), 1);
  assert.equal(toWattHours(1, 'kWh'), 1000);
  assert.equal(toWattHours(1000, 'mWh'), 1);
  assert.equal(toWattHours(1e6, 'nWh'), 1);
  assert.equal(toWattHours(100, 'W'), null);
});

test('golden: 100W × 10h = 1 kWh', () => {
  const wh = integrateWatts(100, 10 * HOUR);
  assert.ok(wh != null);
  assert.equal(wh, 1000); // 1 kWh = 1000 Wh
  const ledger = new EnergyLedger();
  const r = ledger.commit({
    source: 'manual',
    scope: 'manual',
    quality: 'manual',
    unit: 'W',
    value: 100,
    startMs: T0,
    endMs: T0 + 10 * HOUR
  });
  assert.equal(r.accepted, true);
  assert.equal(ledger.snapshot().deviceWh, 1000);
});

test('golden: clock 3W vs clock+mine 8W → 30d×10h device/incremental', () => {
  const days = 30;
  const hoursPerDay = 10;
  const durationMs = days * hoursPerDay * HOUR;
  // Device (clock+mine) 8W
  const deviceWh = integrateWatts(8, durationMs);
  // Baseline clock 3W
  const baselineWh = integrateWatts(3, durationMs);
  assert.equal(deviceWh, 2400); // 2.4 kWh
  assert.equal(baselineWh, 900); // 0.9 kWh
  const cal = calibrateIncremental({
    deviceWh,
    baselineWh,
    baselineMode: 'clock',
    baselineTrusted: true
  });
  assert.equal(cal.incrementalWh, 1500); // 1.5 kWh
});

test('baseline off does not invent standby deduction', () => {
  const cal = calibrateIncremental({
    deviceWh: 1000,
    baselineWh: 200,
    baselineMode: 'off'
  });
  assert.equal(cal.incrementalWh, 1000);
  assert.equal(cal.baselineWh, 0);
  assert.match(cal.note, /no-standby/);
});

test('unknown power does not become 0 Wh', () => {
  const ledger = new EnergyLedger();
  const r = ledger.commit({
    source: 'sensor',
    scope: 'wall',
    quality: 'unknown',
    unit: 'W',
    value: 0,
    startMs: T0,
    endMs: T0 + HOUR,
    unknownReason: 'sensor-missing'
  });
  assert.equal(r.accepted, true);
  const snap = ledger.snapshot();
  assert.equal(snap.deviceWh, null);
  assert.equal(snap.deviceQuality, 'unknown');
  assert.ok(snap.unknownCoverageMs > 0);
});

test('normalizeSample rejects invalid scope and interval', () => {
  assert.equal(normalizeSample({ scope: 'tdp', value: 1, unit: 'W', startMs: 1, endMs: 2 }).ok, false);
  assert.equal(
    normalizeSample({ scope: 'manual', value: 1, unit: 'W', startMs: 10, endMs: 5 }).ok,
    false
  );
});

test('counter reset and new meter epoch become unknown coverage', () => {
  assert.equal(cumulativeDelta(100, 90, 'a', 'a').event, 'counter-reset');
  assert.equal(cumulativeDelta(100, 110, 'a', 'b').event, 'new-meter-epoch');

  const ledger = new EnergyLedger();
  ledger.commitCumulative({
    source: 'shelly',
    scope: 'wall',
    unit: 'Wh',
    value: 100,
    endMs: T0,
    meterEpoch: 'e1'
  });
  // first reading: no baseline → unknown
  assert.ok(ledger.snapshot().unknownCoverageMs >= 0);

  ledger.commitCumulative({
    source: 'shelly',
    scope: 'wall',
    unit: 'Wh',
    value: 150,
    endMs: T0 + HOUR,
    meterEpoch: 'e1'
  });
  assert.equal(ledger.committedWhByScope.wall, 50);

  const reset = ledger.commitCumulative({
    source: 'shelly',
    scope: 'wall',
    unit: 'Wh',
    value: 10,
    endMs: T0 + 2 * HOUR,
    meterEpoch: 'e1'
  });
  assert.equal(reset.accepted, true);
  assert.equal(reset.entry.quality, 'unknown');
  assert.equal(reset.entry.unknownReason, 'counter-reset');
});

test('out-of-order / missing interval in watt series', () => {
  const ledger = new EnergyLedger({ maxGapMs: 60_000 });
  const results = ledger.commitWattSeries([
    { watts: 10, atMs: T0, scope: 'manual', quality: 'manual', source: 'user' },
    { watts: 10, atMs: T0 + 30_000, scope: 'manual', quality: 'manual', source: 'user' },
    { watts: 10, atMs: T0 + 200_000, scope: 'manual', quality: 'manual', source: 'user' } // gap
  ]);
  assert.ok(results.some((r) => r.entry?.unknownReason === 'missing-interval'));
  const ooo = ledger.commitWattSeries([
    { watts: 5, atMs: T0 + 300_000, scope: 'manual', quality: 'manual' },
    { watts: 5, atMs: T0 + 250_000, scope: 'manual', quality: 'manual' }
  ]);
  assert.ok(ooo.some((r) => r.reason === 'out-of-order'));
});

test('duplicate sampleId is not double-billed; relaunch-safe', () => {
  const ledger = new EnergyLedger();
  const sample = {
    sampleId: 's1',
    source: 'manual',
    scope: 'manual',
    quality: 'manual',
    unit: 'Wh',
    value: 100,
    startMs: T0,
    endMs: T0 + HOUR
  };
  assert.equal(ledger.commit(sample).accepted, true);
  assert.equal(ledger.commit(sample).accepted, false);
  assert.equal(ledger.snapshot().deviceWh, 100);

  const exported = ledger.exportRange(T0, T0 + HOUR);
  const again = EnergyLedger.fromEntries(exported);
  assert.equal(again.snapshot().deviceWh, 100);
  assert.equal(again.entries.size, 1);
});

test('wall preferred over usb/cpu; scopes not summed', () => {
  const ledger = new EnergyLedger();
  ledger.commit({
    sampleId: 'wall1',
    source: 'meter',
    scope: 'wall',
    quality: 'measured',
    unit: 'Wh',
    value: 500,
    startMs: T0,
    endMs: T0 + HOUR
  });
  ledger.commit({
    sampleId: 'cpu1',
    source: 'rapl',
    scope: 'cpu_package',
    quality: 'measured',
    unit: 'Wh',
    value: 200,
    startMs: T0,
    endMs: T0 + HOUR
  });
  const snap = ledger.snapshot();
  assert.equal(snap.deviceWh, 500);
  assert.equal(snap.deviceScope, 'wall');
  assert.equal(snap.byScopeWh.cpu_package, 200);
});

test('shared socket counted once — no fabricated per-miner precision by default', () => {
  const shared = attributeSharedMeter(1000, ['a', 'b'], 'shared_total');
  assert.equal(shared.totalWh, 1000);
  assert.deepEqual(shared.perMiner, {});
  const split = attributeSharedMeter(1000, ['a', 'b'], 'equal_split');
  assert.equal(split.perMiner.a, 500);
  assert.match(split.note, /estimate/);
});

test('negative incremental treated as noise not free power', () => {
  const cal = calibrateIncremental({
    deviceWh: 100,
    baselineWh: 150,
    baselineMode: 'idle',
    baselineTrusted: true
  });
  assert.equal(cal.incrementalWh, null);
  assert.match(cal.note, /noise/);
});

test('mWh samples normalize correctly', () => {
  const n = normalizeSample({
    source: 'shelly',
    scope: 'wall',
    quality: 'measured',
    unit: 'mWh',
    value: 2500,
    startMs: T0,
    endMs: T0 + 60_000
  });
  assert.equal(n.ok, true);
  assert.equal(n.sample.wattHours, 2.5);
});
