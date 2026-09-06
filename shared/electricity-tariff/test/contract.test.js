/**
 * Electricity tariff contract tests (#71).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  billFixed,
  billProgressive,
  marginalProgressive,
  billTou,
  billEnergy,
  marginalCost,
  FixedTariff,
  ProgressiveTariff,
  TouTariff,
  roundMoney,
  inMinuteWindow
} from '../js/tariff.js';

/** Artificial tiers from issue #71 — NOT Taipower official rates */
const DEMO_TIERS = [
  { upToKwh: 100, ratePerKwh: 2 },
  { upToKwh: 200, ratePerKwh: 4 },
  { upToKwh: Infinity, ratePerKwh: 7 }
];

test('fixed rate multiplies kWh × price', () => {
  const r = billFixed(10, 5);
  assert.equal(r.ok, true);
  assert.equal(r.amount, 50);
});

test('unknown fixed rate is not treated as zero', () => {
  assert.equal(billFixed(10, null).reason, 'unknown-rate');
  assert.equal(FixedTariff({ ratePerKwh: null }).rateUnknown, true);
  assert.equal(billEnergy(FixedTariff({ ratePerKwh: undefined }), { kwh: 1 }).reason, 'unknown-rate');
});

test('explicit zero and negative user rates allowed', () => {
  assert.equal(billFixed(3, 0).amount, 0);
  assert.equal(billFixed(2, -1).amount, -2);
});

test('progressive golden: home 95 + 10 mining → marginal 30', () => {
  const m = marginalProgressive(95, 10, DEMO_TIERS);
  assert.equal(m.ok, true);
  // 95→100 @2 = 5kWh×2=10; 100→105 @4 = 5×4=20; total 30
  assert.equal(m.amount, 30);
});

test('progressive golden: home 195 + 10 mining → marginal 55', () => {
  const m = marginalProgressive(195, 10, DEMO_TIERS);
  assert.equal(m.ok, true);
  // 195→200 @4 = 5×4=20; 200→205 @7 = 5×7=35; total 55
  assert.equal(m.amount, 55);
});

test('progressive never bills all usage at top tier', () => {
  const b = billProgressive(150, DEMO_TIERS);
  // 100*2 + 50*4 = 200+200 = 400, not 150*7
  assert.equal(b.amount, 400);
});

test('zero usage progressive bill is zero', () => {
  assert.equal(billProgressive(0, DEMO_TIERS).amount, 0);
});

test('cross-midnight TOU window matching', () => {
  assert.equal(inMinuteWindow(23 * 60, 22 * 60, 6 * 60), true);
  assert.equal(inMinuteWindow(3 * 60, 22 * 60, 6 * 60), true);
  assert.equal(inMinuteWindow(12 * 60, 22 * 60, 6 * 60), false);
});

test('TOU bills peak vs off-peak without picking cheapest silently', () => {
  const periods = [
    { id: 'off', ratePerKwh: 2, startMinute: 0, endMinute: 12 * 60 },
    { id: 'peak', ratePerKwh: 6, startMinute: 12 * 60, endMinute: 24 * 60 }
  ];
  const T0 = Date.parse('2026-09-06T00:00:00Z'); // Sunday UTC
  // Fake clock: always peak
  const peakClock = () => ({ minuteOfDay: 13 * 60, dayOfWeek: 0 });
  const r = billTou(
    [{ startMs: T0, endMs: T0 + 3_600_000, kwh: 10 }],
    periods,
    'UTC',
    peakClock
  );
  assert.equal(r.ok, true);
  assert.equal(r.amount, 60);
});

test('TOU spanning boundary marks estimated when coarse', () => {
  const periods = [
    { id: 'a', ratePerKwh: 1, startMinute: 0, endMinute: 60 },
    { id: 'b', ratePerKwh: 3, startMinute: 60, endMinute: 24 * 60 }
  ];
  const start = Date.parse('2026-09-06T00:30:00Z');
  const end = Date.parse('2026-09-06T01:30:00Z');
  const clock = (ms) => {
    const d = new Date(ms);
    return { minuteOfDay: d.getUTCHours() * 60 + d.getUTCMinutes(), dayOfWeek: d.getUTCDay() };
  };
  const r = billTou([{ startMs: start, endMs: end, kwh: 2 }], periods, 'UTC', clock);
  assert.equal(r.ok, true);
  // 30 min @1 + 30 min @3 on equal share of 2 kWh → 1*1 + 1*3 = 4
  assert.ok(Math.abs(r.amount - 4) < 1e-9);
  assert.equal(r.estimated, true);
});

test('billEnergy marginal requires finite baseKwh', () => {
  const prog = ProgressiveTariff({ tiers: DEMO_TIERS });
  assert.equal(billEnergy(prog, { mode: 'marginal', miningKwh: 10 }).reason, 'invalid-base-kwh');
  assert.equal(billEnergy(prog, { mode: 'marginal', baseKwh: 95, miningKwh: 10 }).amount, 30);
});

test('billEnergy / marginalCost dispatch', () => {
  const fixed = FixedTariff({ ratePerKwh: 5 });
  assert.equal(billEnergy(fixed, { kwh: 2 }).amount, 10);
  assert.equal(marginalCost(fixed, 100, 2).amount, 10);

  const prog = ProgressiveTariff({ tiers: DEMO_TIERS });
  assert.equal(marginalCost(prog, 95, 10).amount, 30);
  assert.equal(marginalCost(FixedTariff({ ratePerKwh: null }), 0, 1).reason, 'unknown-rate');
});

test('roundMoney at settlement only', () => {
  assert.equal(roundMoney(10.126, 2), 10.13);
  assert.equal(roundMoney(10.124, 2), 10.12);
});

test('missing household baseline cannot claim exact progressive marginal', () => {
  // When base unknown, callers must not invent; helper still requires numeric base.
  assert.equal(marginalProgressive(NaN, 10, DEMO_TIERS).ok, false);
});
