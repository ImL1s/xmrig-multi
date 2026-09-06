/**
 * Desktop idle / tray / close policy contract tests (#77).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityMatrix } from '../js/matrix.js';
import { planEngineFlags } from '../js/engine.js';
import {
  evaluateDesktopIdle,
  simulate,
  armDesktopMining,
  latchUserStop,
  DEFAULTS
} from '../js/policy.js';
import { resolveCloseBehavior, CLOSE_PREFS } from '../js/close.js';

test('linux does not claim native pause-on-active', () => {
  const m = capabilityMatrix('linux');
  assert.equal(m.pauseOnActive.state, 'unsupported');
  const plan = planEngineFlags('linux', { pauseOnActive: true, pauseOnBattery: true });
  assert.ok(plan.argv.includes('--pause-on-battery'));
  assert.ok(!plan.argv.some((a) => a.startsWith('--pause-on-active')));
  assert.ok(plan.degradations.length > 0);
});

test('windows/macos emit pause-on-active argv', () => {
  for (const os of ['windows', 'macos']) {
    const plan = planEngineFlags(os, { pauseOnActive: 60, pauseOnBattery: true });
    assert.ok(plan.argv.includes('--pause-on-active=60'));
    assert.ok(plan.argv.includes('--pause-on-battery'));
  }
});

test('idle→active→idle with fake timestamps', () => {
  const intent = armDesktopMining();
  const idle = evaluateDesktopIdle({
    os: 'windows',
    intent,
    idleMs: 10 * 60_000,
    idleReliable: true,
    onBattery: false,
    config: { ...DEFAULTS, idleMineAfterMs: 5 * 60_000 }
  });
  assert.equal(idle.kind, 'Mining');
  assert.equal(idle.billEnergy, true);

  const active = evaluateDesktopIdle({
    os: 'windows',
    intent,
    idleMs: 1_000,
    idleReliable: true,
    onBattery: false,
    config: { ...DEFAULTS, idleMineAfterMs: 5 * 60_000 }
  });
  assert.equal(active.kind, 'Paused');
  assert.equal(active.billEnergy, false);

  const idleAgain = evaluateDesktopIdle({
    os: 'windows',
    intent,
    idleMs: 6 * 60_000,
    idleReliable: true,
    onBattery: false
  });
  assert.equal(idleAgain.kind, 'Mining');
});

test('AC unplug pauses; unknown AC waits', () => {
  const intent = armDesktopMining();
  const unplug = evaluateDesktopIdle({
    os: 'windows',
    intent,
    idleMs: 10 * 60_000,
    idleReliable: true,
    onBattery: true
  });
  assert.equal(unplug.kind, 'Paused');

  const unknown = evaluateDesktopIdle({
    os: 'windows',
    intent,
    idleMs: 10 * 60_000,
    idleReliable: true
    // onBattery omitted
  });
  assert.equal(unknown.kind, 'Waiting');
});

test('unreliable idle does not assume idle', () => {
  const v = evaluateDesktopIdle({
    os: 'linux',
    intent: armDesktopMining(),
    onBattery: false,
    idleReliable: false
  });
  assert.equal(v.kind, 'Unavailable');
  assert.ok(v.reasons.some((r) => /not assuming idle/i.test(r)));
});

test('Stop beats idle and login autostart', () => {
  const intent = latchUserStop(armDesktopMining());
  const idle = evaluateDesktopIdle({
    os: 'windows',
    intent,
    idleMs: 99 * 60_000,
    idleReliable: true,
    onBattery: false,
    event: { kind: 'login-launch' },
    config: { ...DEFAULTS, loginAutostart: true, resumeLastSessionOnLaunch: true }
  });
  assert.equal(idle.kind, 'Stopped');
});

test('login autostart and resume-last are separate opt-ins', () => {
  const intent = armDesktopMining();
  const onlyAuto = evaluateDesktopIdle({
    os: 'windows',
    intent,
    idleMs: 10 * 60_000,
    idleReliable: true,
    onBattery: false,
    event: { kind: 'login-launch' },
    config: { ...DEFAULTS, loginAutostart: true, resumeLastSessionOnLaunch: false }
  });
  assert.equal(onlyAuto.kind, 'Waiting');

  const neither = evaluateDesktopIdle({
    os: 'windows',
    intent,
    idleMs: 10 * 60_000,
    idleReliable: true,
    onBattery: false,
    event: { kind: 'login-launch' },
    config: { ...DEFAULTS, loginAutostart: false, resumeLastSessionOnLaunch: true }
  });
  assert.equal(neither.kind, 'Stopped');
});

test('sleep pauses and does not bill energy', () => {
  const v = evaluateDesktopIdle({
    os: 'windows',
    intent: armDesktopMining(),
    idleMs: 10 * 60_000,
    idleReliable: true,
    onBattery: false,
    event: { kind: 'sleep' }
  });
  assert.equal(v.kind, 'Paused');
  assert.equal(v.billEnergy, false);
  assert.equal(v.releaseWake, true);
});

test('close preference never defaults to hide-and-mine', () => {
  const first = resolveCloseBehavior({});
  assert.equal(first.action, 'prompt');
  assert.equal(first.hideToTray, false);

  const quit = resolveCloseBehavior({
    userChoice: CLOSE_PREFS.QUIT_AND_STOP,
    rememberChoice: true
  });
  assert.equal(quit.action, 'quit-and-stop');
  assert.equal(quit.stopMiner, true);

  const trayUnauthorized = resolveCloseBehavior({
    savedPreference: CLOSE_PREFS.MINIMIZE_TO_TRAY,
    sessionAuthorized: false
  });
  assert.equal(trayUnauthorized.action, 'quit-and-stop');
  assert.equal(trayUnauthorized.hideToTray, false);

  const trayOk = resolveCloseBehavior({
    savedPreference: CLOSE_PREFS.MINIMIZE_TO_TRAY,
    sessionAuthorized: true
  });
  assert.equal(trayOk.action, 'minimize-to-tray');
  assert.equal(trayOk.hideToTray, true);
});

test('simulate never claims a real start', () => {
  const s = simulate({
    os: 'windows',
    intent: armDesktopMining(),
    idleMs: 10 * 60_000,
    idleReliable: true,
    onBattery: false
  });
  assert.equal(s.simulated, true);
  assert.equal(s.kind, 'Mining');
});
