/**
 * Quick controls contract tests (#79).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuickCommand,
  receiveQuickCommand,
  applyQuickCommandOrder,
  mayResumeAfterPause,
  OPS
} from '../js/commands.js';
import { buildQuickSnapshot } from '../js/snapshot.js';

const T0 = Date.parse('2026-09-06T12:00:00Z');

test('ops whitelist rejects wallet/argv smuggling', () => {
  assert.throws(() => buildQuickCommand({ type: 'shell' }));
  const cmd = buildQuickCommand({
    type: 'start_profile',
    payload: { walletAddress: '4x', argv: '--donate-level=99', threads: 2 },
    issuedAtMs: T0
  });
  assert.equal(cmd.payload.walletAddress, undefined);
  assert.equal(cmd.payload.argv, undefined);
  assert.equal(cmd.payload.threads, 2);
  assert.ok(OPS.includes('stop_mining'));
});

test('expired and unauthorized rejected; Stop latched blocks Start', () => {
  const start = buildQuickCommand({ type: 'start_profile', issuedAtMs: T0, ttlMs: 1 });
  assert.equal(
    receiveQuickCommand(start, { nowMs: T0 + 1000 }).ack,
    'expired'
  );
  assert.equal(
    receiveQuickCommand(start, { nowMs: T0, authorized: false }).ack,
    'rejected'
  );
  assert.equal(
    receiveQuickCommand(start, { nowMs: T0, userStopLatched: true }).ack,
    'rejected'
  );
});

test('newer Stop beats older Start; duplicates idempotent', () => {
  const a = buildQuickCommand({
    type: 'start_profile',
    commandId: '1',
    issuedAtMs: T0
  });
  const b = buildQuickCommand({
    type: 'stop_mining',
    commandId: '2',
    issuedAtMs: T0 + 10
  });
  const ordered = applyQuickCommandOrder([b, a, a]);
  assert.equal(ordered.effective.type, 'stop_mining');
  assert.ok(ordered.skipped.some((s) => s.skipReason.includes('duplicate')));
});

test('pause resume cancelled by newer Stop', () => {
  const blocked = mayResumeAfterPause({
    pauseIssuedAtMs: T0,
    stopRevisionAtPause: 1,
    currentStopRevision: 2,
    resumeAtMs: T0 + 1000,
    nowMs: T0 + 2000
  });
  assert.equal(blocked.allow, false);

  const ok = mayResumeAfterPause({
    pauseIssuedAtMs: T0,
    stopRevisionAtPause: 1,
    currentStopRevision: 1,
    resumeAtMs: T0 + 1000,
    nowMs: T0 + 2000,
    osStartAllowed: true
  });
  assert.equal(ok.allow, true);
});

test('snapshot separates stop mining vs disable automation labels', () => {
  const s = buildQuickSnapshot({ mining: true, automationArmed: true });
  assert.equal(s.labels.stopMining, 'Stop mining');
  assert.equal(s.labels.disableAutomation, 'Disable automation');
  assert.notEqual(s.labels.stopMining, s.labels.disableAutomation);
});
