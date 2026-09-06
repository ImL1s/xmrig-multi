/**
 * Ambient clock contract tests (#74).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveAmbientMode,
  nextTickMs,
  nightDimFactor,
  formatWallClock,
  sessionElapsedMs,
  redactAddress,
  ambientSideEffects
} from '../js/ambient.js';

test('clock_only never requires wallet/network/miner', () => {
  const m = resolveAmbientMode({ requested: 'clock_only' });
  assert.equal(m.mode, 'clock_only');
  assert.equal(m.requiresWallet, false);
  assert.equal(m.requiresNetwork, false);
  assert.equal(m.mayRequestMine, false);
  const fx = ambientSideEffects(m);
  assert.equal(fx.startMiner, false);
  assert.equal(fx.connectPool, false);
  assert.equal(fx.loadRandomX, false);
});

test('minute-only tick aligns to next minute', () => {
  const now = Date.parse('2026-09-06T12:00:30.000Z');
  const delay = nextTickMs(now, { showSeconds: false });
  assert.equal(delay, 30_000);
});

test('night dim reduces factor overnight', () => {
  assert.equal(nightDimFactor(23 * 60), 0.35);
  assert.equal(nightDimFactor(12 * 60), 1);
});

test('formatWallClock 24h without seconds', () => {
  assert.equal(formatWallClock({ hours: 9, minutes: 5 }), '09:05');
  assert.equal(formatWallClock({ hours: 15, minutes: 5 }, { hour12: true }), '03:05 PM');
});

test('session elapsed uses monotonic and ignores wall jumps', () => {
  assert.equal(sessionElapsedMs(1000, 5000), 4000);
  assert.equal(sessionElapsedMs(5000, 1000), null);
});

test('address redaction never shows full wallet', () => {
  const a = '8AfUwcnoJiRDMXnDGj3zX6bMgfaj9pM1WFGr2pakLm3jSYXVLD5fcDMBzkmk4AeSqWYQTA5aerXJ43W65AT82RMqG6NDBnC';
  const r = redactAddress(a);
  assert.ok(r.includes('…'));
  assert.ok(!r.includes(a.slice(10, 40)));
});
