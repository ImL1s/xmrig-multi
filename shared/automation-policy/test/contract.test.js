/**
 * Automation policy contract tests (#73).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAutomation,
  simulate,
  latchUserStop,
  armAutomation,
  DEFAULTS
} from '../js/automation.js';

const T0 = Date.parse('2026-09-06T12:00:00Z');

function base(over = {}) {
  return {
    nowMs: T0,
    intent: armAutomation({ userStopRevision: 0, sessionArmedRevision: 0 }),
    power: { kind: 'Allowed' },
    thermal: { kind: 'Allowed' },
    os: { coldStartAllowed: true },
    budget: { spentFiatToday: 0, kwhToday: 0, sessionElapsedMs: 0, socPercent: 80 },
    economy: { netFiat: -1, netQuality: 'estimated' },
    config: { ...DEFAULTS, economicGoal: 'hobby', dailySpendCapFiat: 10 },
    ...over
  };
}

test('hobby allows negative estimate when budget remains', () => {
  const v = evaluateAutomation(base());
  assert.equal(v.kind, 'Allowed');
});

test('profit_only forbids negative estimate', () => {
  const v = evaluateAutomation(
    base({ config: { ...DEFAULTS, economicGoal: 'profit_only', dailySpendCapFiat: 10 } })
  );
  assert.equal(v.kind, 'Paused');
  assert.ok(v.reasons.some((r) => /Profit-only/i.test(r)));
});

test('both modes forbid on thermal / Stop', () => {
  const stop = evaluateAutomation(
    base({ intent: latchUserStop(armAutomation({})) })
  );
  assert.equal(stop.kind, 'UserStopped');

  const thermalHobby = evaluateAutomation(
    base({ thermal: { kind: 'Paused', reasons: ['hot'] } })
  );
  assert.equal(thermalHobby.kind, 'Paused');

  const thermalProfit = evaluateAutomation(
    base({
      config: { ...DEFAULTS, economicGoal: 'profit_only' },
      economy: { netFiat: 5, netQuality: 'estimated' },
      thermal: { kind: 'Paused', reasons: ['hot'] }
    })
  );
  assert.equal(thermalProfit.kind, 'Paused');
});

test('Stop stays latched after cool-down and midnight', () => {
  let intent = latchUserStop(armAutomation({}));
  const afterCool = evaluateAutomation(
    base({
      intent,
      thermal: { kind: 'Allowed' },
      nowMs: T0 + 3600_000,
      budget: { spentFiatToday: 0, dayKey: 'next-day' }
    })
  );
  assert.equal(afterCool.kind, 'UserStopped');
});

test('budget cap pauses even in hobby', () => {
  const v = evaluateAutomation(
    base({
      budget: { spentFiatToday: 10, kwhToday: 0, sessionElapsedMs: 0, socPercent: 80 },
      config: { ...DEFAULTS, economicGoal: 'hobby', dailySpendCapFiat: 10 }
    })
  );
  assert.equal(v.kind, 'Paused');
  assert.ok(v.reasons.some((r) => /Daily spend/i.test(r)));
});

test('unknown spend with cap set waits fail-closed', () => {
  const v = evaluateAutomation(
    base({
      budget: { spentFiatToday: null, kwhToday: 0, sessionElapsedMs: 0, socPercent: 80 },
      config: { ...DEFAULTS, economicGoal: 'hobby', dailySpendCapFiat: 10 }
    })
  );
  assert.equal(v.kind, 'Waiting');
});

test('power UserStopped latches intent against revival', () => {
  const armed = armAutomation({});
  const v = evaluateAutomation(
    base({
      intent: armed,
      power: { kind: 'UserStopped', reasons: ['policy-stop'] }
    })
  );
  assert.equal(v.kind, 'UserStopped');
  assert.ok(v.nextIntent.userStopRevision > v.nextIntent.sessionArmedRevision);
  const after = evaluateAutomation(
    base({ intent: v.nextIntent, power: { kind: 'Allowed' } })
  );
  assert.equal(after.kind, 'UserStopped');
});

test('next-sample reserve can trip daily cap early', () => {
  const v = evaluateAutomation(
    base({
      budget: {
        spentFiatToday: 9,
        projectedNextSampleFiat: 1.5,
        kwhToday: 0,
        sessionElapsedMs: 0,
        socPercent: 80
      },
      config: { ...DEFAULTS, economicGoal: 'hobby', dailySpendCapFiat: 10 }
    })
  );
  assert.equal(v.kind, 'Paused');
});

test('profit_only waits when net unknown (not assume free/profit)', () => {
  const v = evaluateAutomation(
    base({
      config: { ...DEFAULTS, economicGoal: 'profit_only' },
      economy: { netFiat: null, netQuality: 'unknown' }
    })
  );
  assert.equal(v.kind, 'Waiting');
});

test('simulate uses same predicate and never starts miner', () => {
  const s = simulate(base(), {
    label: 'overheat',
    thermal: { kind: 'Paused', reasons: ['sim-hot'] }
  });
  assert.equal(s.kind, 'Paused');
  assert.equal(s.startsMiner, false);
  assert.equal(s.simulated, true);
});

test('OS cold start unavailable', () => {
  const v = evaluateAutomation(
    base({ os: { coldStartAllowed: false, reasons: ['FGS quota'] } })
  );
  assert.equal(v.kind, 'Unavailable');
});
