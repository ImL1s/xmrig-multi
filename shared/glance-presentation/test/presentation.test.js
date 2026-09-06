import test from 'node:test';
import assert from 'node:assert/strict';
import { glancePresentation, LIVE_ACTIVITY_TTL_SEC } from '../js/presentation.js';

const t0 = 1_725_000_000_000;

test('live syncQuality but osIsStale never shows LIVE or unlabeled rate', () => {
  const v = glancePresentation({
    status: 'mining',
    hashrateHs: 312.4,
    syncQuality: 'live',
    lastUpdatedAtMs: t0,
    osIsStale: true,
    nowMs: t0 + 10_000
  });
  assert.equal(v.isLive, false);
  assert.equal(v.qualityLabel, 'STALE');
  assert.ok(!v.title.includes('LIVE'));
  assert.equal(v.compactHashrate, '—');
  assert.ok(v.hashrateText == null || v.hashrateText.includes('not live'));
});

test('within TTL live is LIVE; exactly at TTL boundary is not live', () => {
  const fresh = glancePresentation({
    syncQuality: 'live',
    hashrateHs: 100,
    lastUpdatedAtMs: t0,
    osIsStale: false,
    nowMs: t0 + (LIVE_ACTIVITY_TTL_SEC * 1000) - 1
  });
  assert.equal(fresh.isLive, true);
  assert.equal(fresh.qualityLabel, 'LIVE');
  assert.equal(fresh.compactHashrate, '100');

  const atBoundary = glancePresentation({
    syncQuality: 'live',
    hashrateHs: 100,
    lastUpdatedAtMs: t0,
    osIsStale: false,
    nowMs: t0 + LIVE_ACTIVITY_TTL_SEC * 1000
  });
  assert.equal(atBoundary.isLive, false);
  assert.notEqual(atBoundary.qualityLabel, 'LIVE');
  assert.equal(atBoundary.compactHashrate, '—');
});

test('wrong session cannot stay live', () => {
  const v = glancePresentation({
    syncQuality: 'live',
    hashrateHs: 50,
    lastUpdatedAtMs: t0,
    sessionId: 'old',
    expectedSessionId: 'new',
    osIsStale: false,
    nowMs: t0 + 1000
  });
  assert.equal(v.isLive, false);
});

test('offline and clock-only presentations', () => {
  assert.equal(glancePresentation({ clockOnly: true }).title, 'Clock');
  const off = glancePresentation({ syncQuality: 'offline', lastUpdatedAtMs: 0 });
  assert.equal(off.qualityLabel, 'OFFLINE');
  assert.equal(off.hashrateText, null);
});
