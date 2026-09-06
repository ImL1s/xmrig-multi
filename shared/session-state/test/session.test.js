import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SessionPhase,
    createSession,
    reduceSession,
    canStart,
    canStop,
    uiLabel
} from '../js/session.js';

test('start is idempotent while busy', () => {
    let s = createSession();
    s = reduceSession(s, { type: 'BEGIN', sessionId: 'a' });
    assert.equal(s.phase, SessionPhase.Starting);
    assert.equal(canStart(s), false);
    const busy = reduceSession(s, { type: 'BEGIN', sessionId: 'b' });
    assert.equal(busy.sessionId, 'a');
    assert.match(busy.reason, /busy/i);
});

test('process exit while hashing unlocks start (Failed)', () => {
    let s = createSession();
    s = reduceSession(s, { type: 'BEGIN' });
    s = reduceSession(s, { type: 'TRANSITION', phase: SessionPhase.Hashing, processAlive: true, workActive: true });
    assert.equal(canStop(s), true);
    s = reduceSession(s, { type: 'PROCESS_EXIT', reason: 'nonzero-exit' });
    assert.equal(s.phase, SessionPhase.Failed);
    assert.equal(s.processAlive, false);
    assert.equal(canStart(s), true);
    assert.equal(uiLabel(s.phase), 'Failed');
});

test('user stop path ends Stopped not Failed', () => {
    let s = createSession();
    s = reduceSession(s, { type: 'BEGIN' });
    s = reduceSession(s, { type: 'TRANSITION', phase: SessionPhase.Stopping });
    s = reduceSession(s, { type: 'PROCESS_EXIT', reason: 'user-stop' });
    assert.equal(s.phase, SessionPhase.Stopped);
});

test('illegal transitions are ignored without corrupting phase', () => {
    let s = createSession();
    s = reduceSession(s, { type: 'BEGIN' });
    const bad = reduceSession(s, { type: 'TRANSITION', phase: SessionPhase.WaitingForShare });
    assert.equal(bad.phase, SessionPhase.Starting);
    assert.match(bad.reason, /ignored transition/);
});

test('snapshot rebuilds UI from authoritative owner state', () => {
    const s = reduceSession(createSession(), {
        type: 'SNAPSHOT',
        sessionId: 'snap-1',
        phase: SessionPhase.Hashing,
        processAlive: true,
        workActive: true,
        shareAccepted: false,
        reason: 'restored'
    });
    assert.equal(s.sessionId, 'snap-1');
    assert.equal(s.phase, SessionPhase.Hashing);
    assert.equal(canStart(s), false);
});

test('reconnect path Hashing→Reconnecting→Connecting is allowed (#43/#64)', () => {
    let s = createSession();
    s = reduceSession(s, { type: 'BEGIN' });
    s = reduceSession(s, {
        type: 'TRANSITION',
        phase: SessionPhase.Hashing,
        processAlive: true,
        workActive: true
    });
    s = reduceSession(s, {
        type: 'TRANSITION',
        phase: SessionPhase.Reconnecting,
        reason: 'ws-close',
        processAlive: false,
        workActive: false
    });
    assert.equal(s.phase, SessionPhase.Reconnecting);
    s = reduceSession(s, {
        type: 'TRANSITION',
        phase: SessionPhase.Connecting,
        reason: 'backoff-elapsed'
    });
    assert.equal(s.phase, SessionPhase.Connecting);
    assert.equal(canStop(s), true);
});
