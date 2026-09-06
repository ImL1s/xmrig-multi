/**
 * Power policy contract tests (#39) — fake clock + fixtures.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    evaluatePower,
    normalizePowerObservation,
    isEffectivelyPlugged,
    latchUserStop,
    armSession,
    pauseUntilNextPlug,
    evaluateSchedule,
    inWindow,
    DEFAULTS
} from '../js/evaluate.js';

const T0 = Date.parse('2026-09-06T12:00:00Z');

function obs(over = {}) {
    return normalizePowerObservation({
        platformHasBattery: true,
        batteryApiAvailable: true,
        externalPowerPresent: true,
        powerSource: 'ac',
        chargingStatus: 'charging',
        socPercent: 80,
        netBatteryFlowMa: 500,
        timestampMs: T0,
        ...over
    }, T0);
}

test('desktop without battery → Allowed (limits N/A), not fake SOC', () => {
    const v = evaluatePower({
        observation: { platformHasBattery: false },
        intent: armSession({}),
        nowMs: T0
    });
    assert.equal(v.kind, 'Allowed');
    assert.ok(v.reasons.some((r) => /no battery/i.test(r)));
});

test('browser / missing API → Unavailable', () => {
    const v = evaluatePower({
        observation: { platformHasBattery: true, batteryApiAvailable: false },
        intent: armSession({}),
        nowMs: T0
    });
    assert.equal(v.kind, 'Unavailable');
});

test('plugged NOT_CHARGING @ 80% OEM limit is still plugged', () => {
    const o = obs({
        externalPowerPresent: true,
        chargingStatus: 'not_charging',
        socPercent: 80,
        netBatteryFlowMa: 0
    });
    assert.equal(isEffectivelyPlugged(o), true);
    const v = evaluatePower({
        observation: o,
        config: { ...DEFAULTS, chargeToPercentBeforeMine: 50, requireExternalPower: true },
        intent: armSession({}),
        nowMs: T0
    });
    assert.equal(v.kind, 'Allowed');
});

test('FULL but unplugged is not on-charger', () => {
    const o = obs({
        externalPowerPresent: false,
        chargingStatus: 'full',
        socPercent: 100
    });
    assert.equal(isEffectivelyPlugged(o), false);
    const v = evaluatePower({
        observation: o,
        config: { ...DEFAULTS, requireExternalPower: true },
        intent: armSession({}),
        nowMs: T0
    });
    assert.equal(v.kind, 'Paused');
    assert.ok(v.reasons.some((r) => /FULL but not plugged|External power/i.test(r)));
});

test('charge-first then allow mining', () => {
    const low = obs({ socPercent: 30, chargingStatus: 'charging' });
    let v = evaluatePower({
        observation: low,
        config: { ...DEFAULTS, chargeToPercentBeforeMine: 50 },
        intent: armSession({}),
        nowMs: T0
    });
    assert.equal(v.kind, 'Waiting');
    assert.ok(v.reasons.some((r) => /Charging first/i.test(r)));

    v = evaluatePower({
        observation: obs({ socPercent: 55, chargingStatus: 'charging' }),
        config: { ...DEFAULTS, chargeToPercentBeforeMine: 50 },
        intent: armSession({}),
        nowMs: T0 + 60_000
    });
    assert.equal(v.kind, 'Allowed');
});

test('net discharge while plugged pauses', () => {
    const v = evaluatePower({
        observation: obs({
            externalPowerPresent: true,
            chargingStatus: 'not_charging',
            socPercent: 70,
            netBatteryFlowMa: -200
        }),
        config: { ...DEFAULTS, chargeToPercentBeforeMine: null, pauseOnNetDischargeWhilePlugged: true },
        intent: armSession({}),
        nowMs: T0
    });
    assert.equal(v.kind, 'Paused');
    assert.ok(v.reasons.some((r) => /net discharge/i.test(r)));
});

test('manual Stop survives plug events', () => {
    let intent = latchUserStop(armSession({}));
    let v = evaluatePower({
        observation: obs({ externalPowerPresent: false }),
        intent,
        nowMs: T0
    });
    assert.equal(v.kind, 'UserStopped');

    v = evaluatePower({
        observation: obs({ externalPowerPresent: true, chargingStatus: 'charging' }),
        intent,
        nowMs: T0 + 5_000
    });
    assert.equal(v.kind, 'UserStopped');

    intent = armSession(intent);
    v = evaluatePower({
        observation: obs({ socPercent: 90 }),
        intent,
        config: { ...DEFAULTS, chargeToPercentBeforeMine: 50 },
        nowMs: T0 + 10_000
    });
    assert.equal(v.kind, 'Allowed');
});

test('pause-until-next-plug is not Stop', () => {
    let intent = pauseUntilNextPlug(armSession({}), true);
    let v = evaluatePower({
        observation: obs({ externalPowerPresent: true }),
        intent,
        nowMs: T0
    });
    assert.equal(v.kind, 'Waiting');
    intent = v.nextIntent;

    // unplug
    v = evaluatePower({
        observation: obs({ externalPowerPresent: false, chargingStatus: 'discharging' }),
        intent,
        nowMs: T0 + 1_000
    });
    intent = v.nextIntent;
    assert.equal(intent.wasPluggedWhenPaused, false);

    // replug → clear
    v = evaluatePower({
        observation: obs({ externalPowerPresent: true, socPercent: 90 }),
        intent,
        config: { ...DEFAULTS, chargeToPercentBeforeMine: 50 },
        nowMs: T0 + 2_000
    });
    assert.equal(v.kind, 'Allowed');
    assert.equal(v.nextIntent.pauseUntilNextPlug, false);
});

test('cross-midnight schedule window', () => {
    // 22:00–06:00 UTC
    const windows = [{ startMin: 22 * 60, endMin: 6 * 60 }];
    assert.equal(inWindow(23 * 60, 22 * 60, 6 * 60), true);
    assert.equal(inWindow(3 * 60, 22 * 60, 6 * 60), true);
    assert.equal(inWindow(12 * 60, 22 * 60, 6 * 60), false);

    const inside = evaluateSchedule(T0, windows, 23 * 60);
    assert.equal(inside.allowed, true);

    const outside = evaluateSchedule(T0, windows, 12 * 60);
    assert.equal(outside.allowed, false);
    assert.ok(outside.nextEvalAtMs > T0);

    const v = evaluatePower({
        observation: obs({ socPercent: 90 }),
        config: { ...DEFAULTS, allowWindows: windows, chargeToPercentBeforeMine: null },
        intent: armSession({}),
        nowMs: T0,
        minuteOfDay: 12 * 60
    });
    assert.equal(v.kind, 'Waiting');
});

test('USB / AC / wireless / unknown sources normalize', () => {
    assert.equal(normalizePowerObservation({ powerSource: 'USB', externalPowerPresent: true }).powerSource, 'usb');
    assert.equal(normalizePowerObservation({ powerSource: 'wireless', externalPowerPresent: true }).powerSource, 'wireless');
    assert.equal(normalizePowerObservation({ powerSource: 'mystery', externalPowerPresent: true }).powerSource, 'unknown');
});

test('read failure and sentinel SOC are conservative', () => {
    let v = evaluatePower({
        observation: { readFailed: true, platformHasBattery: true, batteryApiAvailable: true },
        intent: armSession({}),
        nowMs: T0
    });
    assert.equal(v.kind, 'Waiting');

    v = evaluatePower({
        observation: obs({ socPercent: 0, suspectZero: true }),
        intent: armSession({}),
        nowMs: T0
    });
    assert.equal(v.kind, 'Waiting');
});

test('policy pause preserves session data flag', () => {
    const v = evaluatePower({
        observation: obs({ externalPowerPresent: false, chargingStatus: 'discharging', socPercent: 90 }),
        intent: armSession({}),
        nowMs: T0
    });
    assert.equal(v.kind, 'Paused');
    assert.equal(v.preservesSessionData, true);
});

test('max session and metered preference', () => {
    let v = evaluatePower({
        observation: { platformHasBattery: false },
        config: { ...DEFAULTS, maxSessionMs: 60_000 },
        intent: armSession({}),
        session: { elapsedMs: 60_000 },
        nowMs: T0
    });
    assert.equal(v.kind, 'Paused');

    v = evaluatePower({
        observation: { platformHasBattery: false },
        config: { ...DEFAULTS, preferUnmetered: true },
        intent: armSession({}),
        network: { metered: true, available: true },
        nowMs: T0
    });
    assert.equal(v.kind, 'Waiting');
});
