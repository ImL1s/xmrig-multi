/**
 * Thermal policy contract tests (#38) — fake clock.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    evaluateThermal,
    normalizeObservation,
    belowResumeThreshold,
    DEFAULTS
} from '../js/evaluate.js';

const T0 = Date.parse('2026-09-06T12:00:00Z');

function bat(celsius, ts = T0, extra = {}) {
    return { source: 'battery', celsius, timestampMs: ts, ...extra };
}

test('0°C sentinel is not healthy', () => {
    const obs = normalizeObservation(bat(0, T0, { suspectZero: true }), T0);
    assert.equal(obs.quality, 'sentinel');
    const d = evaluateThermal({
        observation: obs,
        state: { phase: 'allowed', sinceMs: T0, permanentThreads: 4 },
        nowMs: T0
    });
    assert.equal(d.phase, 'soft_throttle');
    assert.ok(d.reasons.some((r) => /sentinel|not treating as healthy/i.test(r)));
});

test('NaN / unknown quality → conservative soft throttle', () => {
    const obs = normalizeObservation({ source: 'cpu', celsius: NaN, timestampMs: T0 }, T0);
    assert.equal(obs.quality, 'nan');
    const d = evaluateThermal({
        observation: obs,
        state: { phase: 'allowed', sinceMs: T0, permanentThreads: 8 },
        nowMs: T0
    });
    assert.equal(d.phase, 'soft_throttle');
    assert.equal(d.permanentProfileUnchanged, true);
});

test('heat-up: soft → pause → critical with separate battery limits', () => {
    let state = { phase: 'allowed', sinceMs: T0, permanentThreads: 4, effectiveThreads: 4, cooldownUntilMs: null };

    let d = evaluateThermal({ observation: bat(43), state, nowMs: T0 });
    assert.equal(d.phase, 'soft_throttle');
    assert.equal(d.action, 'throttle');
    assert.equal(d.effectiveThreads, 2);
    assert.equal(d.permanentProfileUnchanged, true);
    state = d.nextState;

    d = evaluateThermal({ observation: bat(46), state, nowMs: T0 + 1_000 });
    assert.equal(d.phase, 'paused');
    assert.equal(d.action, 'pause');
    state = d.nextState;

    d = evaluateThermal({ observation: bat(51), state, nowMs: T0 + 2_000 });
    assert.equal(d.phase, 'critical');
    assert.equal(d.action, 'critical_stop');
});

test('CPU thresholds are not the battery 45°C assumption', () => {
    const d = evaluateThermal({
        observation: { source: 'cpu', celsius: 46, timestampMs: T0 },
        state: { phase: 'allowed', sinceMs: T0, permanentThreads: 8 },
        nowMs: T0
    });
    // 46°C is fine for CPU (soft at 80)
    assert.equal(d.phase, 'allowed');
});

test('hysteresis + cooldown + min hold before resume', () => {
    let state = {
        phase: 'paused',
        sinceMs: T0,
        permanentThreads: 4,
        effectiveThreads: 0,
        cooldownUntilMs: null
    };

    // Still above resume (40) even if below pause (45)
    let d = evaluateThermal({
        observation: bat(41),
        state,
        nowMs: T0 + 5_000,
        config: { ...DEFAULTS, minHoldMs: 30_000, cooldownMs: 60_000 }
    });
    assert.equal(d.action, 'hold');
    assert.ok(d.reasons.some((r) => /hysteresis|resume/i.test(r)));

    // Below resume but min hold not elapsed
    d = evaluateThermal({
        observation: bat(38),
        state,
        nowMs: T0 + 10_000,
        config: { ...DEFAULTS, minHoldMs: 30_000, cooldownMs: 60_000 }
    });
    assert.equal(d.action, 'hold');
    assert.ok(d.nextState.cooldownUntilMs != null);
    state = d.nextState;

    // Min hold done, still in cooldown
    d = evaluateThermal({
        observation: bat(38),
        state,
        nowMs: T0 + 35_000,
        config: { ...DEFAULTS, minHoldMs: 30_000, cooldownMs: 60_000 }
    });
    assert.equal(d.action, 'hold');
    assert.ok(d.reasons.some((r) => /cooldown/i.test(r)));
    state = d.nextState;

    // Cooldown complete → resume
    d = evaluateThermal({
        observation: bat(38),
        state,
        nowMs: state.cooldownUntilMs,
        config: { ...DEFAULTS, minHoldMs: 30_000, cooldownMs: 60_000 }
    });
    assert.equal(d.phase, 'allowed');
    assert.equal(d.action, 'resume');
    assert.equal(d.effectiveThreads, 4);
});

test('threshold jitter does not flap when hovering near pause', () => {
    let state = { phase: 'allowed', sinceMs: T0, permanentThreads: 4, cooldownUntilMs: null };
    const cfg = { ...DEFAULTS, minHoldMs: 30_000, cooldownMs: 60_000 };

    let d = evaluateThermal({ observation: bat(46), state, nowMs: T0, config: cfg });
    assert.equal(d.phase, 'paused');
    state = d.nextState;

    // Drop slightly below pause but above resume — stay paused (hysteresis)
    d = evaluateThermal({ observation: bat(44.5), state, nowMs: T0 + 2_000, config: cfg });
    assert.equal(d.phase, 'paused');
    assert.notEqual(d.action, 'resume');
});

test('manual Stop blocks thermal auto-resume', () => {
    const d = evaluateThermal({
        observation: bat(30),
        state: { phase: 'paused', sinceMs: T0, permanentThreads: 4 },
        nowMs: T0 + 120_000,
        userStopped: true
    });
    assert.equal(d.action, 'hold');
    assert.ok(d.reasons.some((r) => /manual stop/i.test(r)));
});

test('OS critical cannot be softened by user config', () => {
    const d = evaluateThermal({
        observation: { source: 'os_status', osStatus: 'critical', timestampMs: T0 },
        state: { phase: 'allowed', sinceMs: T0, permanentThreads: 4 },
        nowMs: T0,
        config: { ...DEFAULTS, batteryCriticalC: 999, cpuCriticalC: 999 }
    });
    assert.equal(d.phase, 'critical');
});

test('stale reading is conservative', () => {
    const obs = normalizeObservation(bat(30, T0), T0 + DEFAULTS.staleAfterMs + 1);
    assert.equal(obs.quality, 'stale');
    const d = evaluateThermal({
        observation: obs,
        state: { phase: 'allowed', sinceMs: T0, permanentThreads: 4 },
        nowMs: T0 + DEFAULTS.staleAfterMs + 1
    });
    assert.equal(d.phase, 'soft_throttle');
});

test('belowResumeThreshold helper', () => {
    assert.equal(belowResumeThreshold(bat(39), DEFAULTS, T0), true);
    assert.equal(belowResumeThreshold(bat(41), DEFAULTS, T0), false);
});

test('temporary throttle does not rewrite permanent threads', () => {
    const d = evaluateThermal({
        observation: bat(43),
        state: { phase: 'allowed', sinceMs: T0, permanentThreads: 6 },
        nowMs: T0
    });
    assert.equal(d.nextState.permanentThreads, 6);
    assert.equal(d.effectiveThreads, 3);
    assert.equal(d.permanentProfileUnchanged, true);
});
