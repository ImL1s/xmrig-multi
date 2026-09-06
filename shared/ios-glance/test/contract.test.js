/**
 * iOS glance contract tests (#78).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { glanceSupportMatrix } from '../js/matrix.js';
import {
  buildGlanceSnapshot,
  classifyGlanceFreshness,
  presentGlance,
  redactSnapshot
} from '../js/snapshot.js';
import { planGlanceTimeline } from '../js/timeline.js';

const T0 = Date.parse('2026-09-06T12:00:00Z');

test('StandBy not claimed on iPad or pre-iOS17', () => {
  assert.equal(glanceSupportMatrix({ iosMajor: 16, isIpad: false }).standBy.state, 'unsupported');
  assert.equal(glanceSupportMatrix({ iosMajor: 17, isIpad: true }).standBy.state, 'unsupported');
  assert.equal(glanceSupportMatrix({ iosMajor: 17, isIpad: false }).standBy.state, 'available');
  assert.equal(glanceSupportMatrix({ iosMajor: 17 }).claims.backgroundMiningViaWidget, false);
});

test('snapshot redacts wallet and secrets', () => {
  const snap = buildGlanceSnapshot({
    status: 'mining',
    hashrateHs: 1200,
    walletAddress: '4secret',
    poolPassword: 'x',
    sessionId: 's1',
    nowMs: T0
  });
  assert.equal(snap.status, 'mining');
  assert.equal(snap.hashrateHs, 1200);
  assert.equal(snap.walletAddress, undefined);
  assert.equal(snap.poolPassword, undefined);
  const dirty = redactSnapshot({ seed: 'abc', hashrateHs: 1 });
  assert.equal(dirty.seed, undefined);
});

test('stale and session change never show as live', () => {
  const stale = classifyGlanceFreshness({
    nowMs: T0 + 120_000,
    lastUpdatedAtMs: T0,
    appPresent: true,
    processAlive: true
  });
  assert.equal(stale.quality, 'stale');
  assert.equal(stale.showAsLive, false);

  const session = classifyGlanceFreshness({
    nowMs: T0,
    lastUpdatedAtMs: T0,
    sessionId: 'a',
    expectedSessionId: 'b',
    appPresent: true,
    processAlive: true
  });
  assert.equal(session.showAsLive, false);
  assert.equal(session.showHashrate, false);

  const dead = classifyGlanceFreshness({
    nowMs: T0,
    lastUpdatedAtMs: T0,
    appTerminated: true
  });
  assert.match(dead.label, /not live|snapshot/i);
});

test('presentGlance does not claim live mining when stale', () => {
  const snap = buildGlanceSnapshot({ status: 'mining', hashrateHs: 500, nowMs: T0 });
  const fresh = classifyGlanceFreshness({
    nowMs: T0 + 200_000,
    lastUpdatedAtMs: T0,
    appPresent: true,
    processAlive: true
  });
  const view = presentGlance(snap, fresh);
  assert.equal(view.claimLiveMining, false);
  assert.match(view.hashrateLabel || '', /not live/i);
});

test('timeline is minute-aligned and forbids per-second mining polls', () => {
  const plan = planGlanceTimeline(T0, { showSeconds: false });
  assert.ok(plan.reloadAfterMs <= 60_000);
  assert.ok(plan.forbids.some((f) => /per-second/i.test(f)));
});

test('clock-only presentation hides miner claims', () => {
  const view = presentGlance(
    buildGlanceSnapshot({ clockOnly: true, status: 'mining', hashrateHs: 9, nowMs: T0 }),
    { showAsLive: true, label: 'Live' }
  );
  assert.equal(view.claimLiveMining, false);
  assert.equal(view.hashrateLabel, null);
});
