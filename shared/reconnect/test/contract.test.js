/**
 * Reconnect controller contract tests (#43).
 * Run: node --test shared/reconnect/test/*.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDisconnect } from '../js/classify.js';
import { canAttempt, nextBackoff } from '../js/backoff.js';
import { isCompatibleBackup, selectFailoverTarget, shouldReturnToPrimary } from '../js/failover.js';
import {
    beginSession,
    createReconnectState,
    onDisconnect,
    onPolicyPause,
    onProfileChange,
    onRetryDue,
    onUserStop,
    recordShare,
    uiSnapshot
} from '../js/controller.js';

const fixedRandom = () => 0.5;

test('autoReconnect=false stops without scheduling retry', () => {
    let state = createReconnectState({ autoReconnect: false, maxAttempts: 5 });
    state = beginSession(state, { endpointId: 'primary', at: 1000 });
    const { state: next, action } = onDisconnect(state, {
        code: 'timeout',
        at: 2000,
        random: fixedRandom
    });
    assert.equal(next.phase, 'failed');
    assert.equal(next.nextRetryAt, null);
    assert.equal(action.type, 'stop');
    assert.match(action.reason, /autoReconnect disabled/i);
});

test('retryable disconnect schedules bounded backoff with fake clock', () => {
    let state = createReconnectState({ autoReconnect: true, maxAttempts: 3, baseMs: 1000, maxMs: 8000 });
    state = beginSession(state, { endpointId: 'primary', at: 0 });
    const r1 = onDisconnect(state, { code: 'network', message: 'wifi drop', at: 10_000, random: () => 0 });
    assert.equal(r1.action.type, 'wait');
    assert.equal(r1.state.phase, 'reconnecting');
    assert.equal(r1.state.attempt, 1);
    assert.ok(r1.action.delayMs <= 1000);
    assert.equal(r1.state.nextRetryAt, 10_000 + r1.action.delayMs);

    const snap = uiSnapshot(r1.state);
    assert.equal(snap.canCancel, true);
    assert.ok(snap.nextRetryAt);

    const due = onRetryDue(r1.state, { at: r1.state.nextRetryAt });
    assert.equal(due.action.type, 'reconnect');
    assert.equal(due.state.phase, 'mining');
});

test('auth failure is fatal — no reconnect storm', () => {
    let state = createReconnectState({ autoReconnect: true, maxAttempts: 10 });
    state = beginSession(state, { endpointId: 'primary' });
    const { state: next, action } = onDisconnect(state, { code: 'auth_fail', message: 'login error' });
    assert.equal(next.phase, 'failed');
    assert.equal(action.type, 'stop');
    assert.equal(next.lastClassification.retryable, false);
});

test('attempts are bounded — no infinite reconnect', () => {
    let state = createReconnectState({ autoReconnect: true, maxAttempts: 2, baseMs: 100, maxMs: 1000 });
    state = beginSession(state, { endpointId: 'p' });
    for (let i = 0; i < 2; i++) {
        const r = onDisconnect(state, { code: 'timeout', at: i * 1000, random: fixedRandom });
        assert.equal(r.action.type, 'wait');
        state = r.state;
    }
    const exhausted = onDisconnect(state, { code: 'timeout', at: 5000, random: fixedRandom });
    assert.equal(exhausted.state.phase, 'failed');
    assert.equal(exhausted.action.type, 'stop');
    assert.match(exhausted.state.reason, /exhausted/i);
});

test('user stop cancels pending retry', () => {
    let state = createReconnectState({ autoReconnect: true });
    state = beginSession(state, { endpointId: 'p' });
    const mid = onDisconnect(state, { code: 'dns', at: 100, random: fixedRandom });
    state = onUserStop(mid.state, 200);
    assert.equal(state.phase, 'stopped');
    assert.equal(state.cancelled, true);
    assert.equal(state.nextRetryAt, null);
    const after = onRetryDue(state, { at: 99999 });
    assert.equal(after.action.type, 'none');
});

test('thermal pause does not auto-restart', () => {
    let state = createReconnectState({ autoReconnect: true });
    state = beginSession(state, { endpointId: 'p' });
    const { state: paused, action } = onDisconnect(state, { code: 'thermal', message: 'thermal critical' });
    assert.equal(paused.phase, 'paused');
    assert.equal(action.type, 'pause');
    state = onPolicyPause(state, 'thermal critical', 50);
    const due = onRetryDue(state, { at: 99999 });
    assert.equal(due.action.type, 'none');
});

test('profile change invalidates reconnect generation', () => {
    let state = createReconnectState({ autoReconnect: true, profileRevision: 1 });
    state = beginSession(state, { endpointId: 'p', profileRevision: 1 });
    const mid = onDisconnect(state, { code: 'network', at: 1, random: fixedRandom });
    state = onProfileChange(mid.state, 2, 2);
    assert.equal(state.phase, 'stopped');
    assert.equal(state.profileRevision, 2);
    assert.equal(onRetryDue(state, { at: 100 }).action.type, 'none');
});

test('failover refuses wallet / TLS downgrade / unapproved backups', () => {
    const primary = {
        id: 'p1',
        url: 'pool.example:443',
        payoutAsset: 'XMR',
        accountUser: 'addrA',
        tls: true,
        protocol: 'stratum',
        userApproved: true
    };
    assert.equal(
        isCompatibleBackup(primary, {
            ...primary,
            id: 'bad-wallet',
            accountUser: 'addrB',
            userApproved: true
        }).ok,
        false
    );
    assert.equal(
        isCompatibleBackup(primary, {
            ...primary,
            id: 'tls-down',
            tls: false,
            userApproved: true
        }).ok,
        false
    );
    const pick = selectFailoverTarget(primary, [
        { ...primary, id: 'unapproved', url: 'backup:443', userApproved: false },
        { ...primary, id: 'ok', url: 'backup2:443', userApproved: true }
    ], { failedId: 'p1' });
    assert.equal(pick.ok, true);
    assert.equal(pick.endpoint.id, 'ok');
});

test('failover after attempts exhausted when backups exist', () => {
    const primary = {
        id: 'p1',
        url: 'pool:443',
        payoutAsset: 'XMR',
        accountUser: 'w',
        tls: true,
        protocol: 'stratum',
        userApproved: true
    };
    const backup = { ...primary, id: 'b1', url: 'backup:443', userApproved: true };
    let state = createReconnectState({ autoReconnect: true, maxAttempts: 1, baseMs: 10 });
    state = beginSession(state, { endpointId: 'p1' });
    state = onDisconnect(state, { code: 'timeout', at: 1, random: fixedRandom }).state;
    const fo = onDisconnect(state, {
        code: 'timeout',
        at: 100,
        random: fixedRandom,
        primary,
        backups: [backup]
    });
    assert.equal(fo.action.type, 'failover');
    assert.equal(fo.state.activeEndpointId, 'b1');
    assert.equal(fo.state.phase, 'failover');
});

test('session stats preserved; per-endpoint shares separated', () => {
    let state = createReconnectState();
    state = beginSession(state, { endpointId: 'p1' });
    state = recordShare(state, { endpointId: 'p1', accepted: true });
    state = recordShare(state, { endpointId: 'b1', accepted: true });
    state = recordShare(state, { endpointId: 'b1', accepted: false });
    assert.equal(state.sessionStats.accepted, 2);
    assert.equal(state.sessionStats.rejected, 1);
    assert.equal(state.endpointStats.p1.accepted, 1);
    assert.equal(state.endpointStats.b1.accepted, 1);
    assert.equal(state.endpointStats.b1.rejected, 1);
});

test('return-to-primary cooldown', () => {
    assert.equal(shouldReturnToPrimary({ lastPrimaryFailAt: 0, now: 1000, returnAfterMs: 500 }), true);
    assert.equal(shouldReturnToPrimary({ lastPrimaryFailAt: 900, now: 1000, returnAfterMs: 500 }), false);
    assert.equal(shouldReturnToPrimary({ lastPrimaryFailAt: 400, now: 1000, returnAfterMs: 500 }), true);
});

test('classify Wi-Fi→cellular style network loss as retryable', () => {
    const c = classifyDisconnect({ message: 'network change wifi to cellular' });
    assert.equal(c.retryable, true);
});

test('canAttempt respects retries=0', () => {
    assert.equal(canAttempt({ autoReconnect: true, retries: 0 }, 0), false);
    assert.equal(canAttempt({ autoReconnect: true, maxAttempts: 3 }, 2), true);
    assert.equal(canAttempt({ autoReconnect: true, maxAttempts: 3 }, 3), false);
});

test('backoff caps at maxMs', () => {
    const { delayMs, capped } = nextBackoff({
        attempt: 20,
        baseMs: 1000,
        maxMs: 5000,
        jitterRatio: 0,
        random: () => 0
    });
    assert.equal(capped, true);
    assert.equal(delayMs, 5000);
});
