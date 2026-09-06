/**
 * Companion sync contract tests (#62).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    classifySync,
    buildCommand,
    receiveCommand,
    applyCommandOrder,
    redactSecrets,
    buildStatsSnapshot,
    DEFAULT_STALE_AFTER_MS
} from '../js/protocol.js';

const T0 = Date.parse('2026-09-06T12:00:00Z');

test('unpaired / unreachable is offline and never showAsLive', () => {
    const a = classifySync({ paired: false, reachable: true, lastSyncAtMs: T0, nowMs: T0 });
    assert.equal(a.quality, 'offline');
    assert.equal(a.showAsLive, false);

    const b = classifySync({ paired: true, reachable: false, lastSyncAtMs: T0, nowMs: T0 });
    assert.equal(b.quality, 'offline');
    assert.equal(b.showAsLive, false);
});

test('stale after threshold — last numbers not live', () => {
    const s = classifySync({
        paired: true,
        reachable: true,
        lastSyncAtMs: T0,
        nowMs: T0 + DEFAULT_STALE_AFTER_MS + 1
    });
    assert.equal(s.quality, 'stale');
    assert.equal(s.showAsLive, false);
    assert.match(s.label, /Stale/i);
});

test('live within stale window', () => {
    const s = classifySync({
        paired: true,
        reachable: true,
        lastSyncAtMs: T0,
        nowMs: T0 + 1_000,
        sourceDeviceId: 'phone-1',
        sessionId: 'sess-9'
    });
    assert.equal(s.quality, 'live');
    assert.equal(s.showAsLive, true);
    assert.equal(s.sourceDeviceId, 'phone-1');
});

test('buildCommand requires target and redacts secrets', () => {
    assert.throws(() => buildCommand({ type: 'start' }), /targetDeviceId/);
    const cmd = buildCommand({
        type: 'start',
        targetDeviceId: 'phone-1',
        profileId: 'default',
        sessionId: 's1',
        issuedAtMs: T0,
        payload: { walletAddress: '4abc', threads: 2, password: 'x' }
    });
    assert.equal(cmd.type, 'start');
    assert.equal(cmd.expiresAtMs, T0 + 60_000);
    assert.equal(cmd.payload.threads, 2);
    assert.equal(cmd.payload.walletAddress, undefined);
    assert.equal(cmd.payload.password, undefined);
});

test('receiveCommand: expired / thermal / missing config / user stop', () => {
    const base = buildCommand({
        type: 'start',
        targetDeviceId: 'phone-1',
        sessionId: 's1',
        issuedAtMs: T0,
        expiresAtMs: T0 + 1000
    });

    assert.equal(
        receiveCommand(base, { nowMs: T0 + 2000, paired: true, authenticated: true, reachable: true }).ack,
        'expired'
    );
    assert.equal(
        receiveCommand(base, {
            nowMs: T0,
            paired: true,
            authenticated: true,
            reachable: true,
            thermalBlocked: true
        }).ack,
        'rejected'
    );
    assert.equal(
        receiveCommand(base, {
            nowMs: T0,
            paired: true,
            authenticated: true,
            reachable: true,
            missingConfig: true
        }).reason.match(/profile/i)[0].length > 0,
        true
    );
    assert.equal(
        receiveCommand(base, {
            nowMs: T0,
            paired: true,
            authenticated: true,
            reachable: true,
            userStopLatched: true
        }).apply,
        false
    );
});

test('receiveCommand stop accepted when policy ok', () => {
    const stop = buildCommand({ type: 'stop', targetDeviceId: 'phone-1', issuedAtMs: T0 });
    const r = receiveCommand(stop, {
        nowMs: T0,
        paired: true,
        authenticated: true,
        reachable: true
    });
    assert.equal(r.ack, 'accepted');
    assert.equal(r.apply, true);
});

test('undelivered when phone unreachable', () => {
    const stop = buildCommand({ type: 'stop', targetDeviceId: 'phone-1', issuedAtMs: T0 });
    const r = receiveCommand(stop, {
        nowMs: T0,
        paired: true,
        authenticated: true,
        reachable: false
    });
    assert.equal(r.ack, 'undelivered');
    assert.match(r.reason, /not guaranteed/i);
});

test('older Start cannot override newer Stop; duplicates idempotent', () => {
    const stop = buildCommand({
        type: 'stop',
        targetDeviceId: 'p',
        commandId: 'c-stop',
        issuedAtMs: T0 + 100
    });
    const startOld = buildCommand({
        type: 'start',
        targetDeviceId: 'p',
        commandId: 'c-start',
        issuedAtMs: T0
    });
    const dup = { ...stop };

    const ordered = applyCommandOrder([startOld, stop, dup]);
    assert.equal(ordered.effective.type, 'stop');
    assert.ok(ordered.skipped.some((s) => /duplicate/i.test(s.skipReason)));
    assert.ok(ordered.skipped.some((s) => /superseded by newer Stop/i.test(s.skipReason)));
});

test('redactSecrets strips wallet and tokens', () => {
    const clean = redactSecrets({
        threads: 4,
        wallet: 'secret',
        apiToken: 't',
        nested: { poolPassword: 'p', ok: 1 }
    });
    assert.equal(clean.threads, 4);
    assert.equal(clean.wallet, undefined);
    assert.equal(clean.apiToken, undefined);
    assert.equal(clean.nested.poolPassword, undefined);
    assert.equal(clean.nested.ok, 1);
});

test('buildStatsSnapshot offline clears live running flag', () => {
    const snap = buildStatsSnapshot({
        paired: true,
        reachable: false,
        lastSyncAtMs: T0,
        nowMs: T0,
        isRunning: true,
        hashrate: 123,
        walletAddress: '4abc'
    });
    assert.equal(snap.syncQuality, 'offline');
    assert.equal(snap.isRunning, false);
    assert.equal(snap.lastHashrate, 123);
    assert.equal(snap.secretsPresent, false);
    assert.equal(snap.walletAddress, undefined);
});

test('session mismatch rejects command after phone restart', () => {
    const cmd = buildCommand({
        type: 'start',
        targetDeviceId: 'phone-1',
        sessionId: 'old',
        issuedAtMs: T0
    });
    const r = receiveCommand(cmd, {
        nowMs: T0,
        paired: true,
        authenticated: true,
        reachable: true,
        sessionId: 'new'
    });
    assert.equal(r.ack, 'rejected');
    assert.match(r.reason, /session/i);
});
