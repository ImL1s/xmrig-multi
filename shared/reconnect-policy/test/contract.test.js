/**
 * Reconnect policy contract tests (#43 / #64 harness).
 * Run: node --test shared/reconnect-policy/test/*.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyFailure } from '../js/classify.js';
import { nativeRetries, nextBackoffMs } from '../js/backoff.js';
import { decideReconnect } from '../js/decide.js';
import { canFailoverTo, nextFailover } from '../js/failover.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (name) => JSON.parse(readFileSync(join(root, 'fixtures', name), 'utf8'));

test('autoReconnect=false never schedules retry', () => {
    const d = decideReconnect({
        autoReconnect: false,
        error: { code: 'timeout', message: 'timed out' },
        attempt: 0
    });
    assert.equal(d.action, 'stop');
    assert.equal(nativeRetries(false, 5), 0);
    assert.equal(nativeRetries(true, 5), 5);
});

test('fixtures: dns blip retries; auth and TLS stop', () => {
    for (const name of ['dns-blip.json', 'auth-fail.json', 'tls-cert.json']) {
        const f = fixture(name);
        const d = decideReconnect({
            autoReconnect: f.autoReconnect,
            error: f.error,
            attempt: 0,
            backoff: { random: () => 0.5 }
        });
        assert.equal(d.action, f.expectAction, name);
    }
});

test('backoff is bounded and uses fake random (no storm)', () => {
    const delays = [];
    for (let attempt = 0; attempt < 20; attempt++) {
        delays.push(
            nextBackoffMs({
                attempt,
                baseMs: 1000,
                maxMs: 8000,
                jitterRatio: 0,
                random: () => 0.5
            })
        );
    }
    assert.ok(delays.every((d) => d <= 8000));
    assert.equal(delays[0], 1000);
    assert.equal(delays[3], 8000);
    // After cap, stays capped — no unbounded growth
    assert.ok(delays.slice(3).every((d) => d === 8000));
});

test('retry budget exhausts without infinite loop', () => {
    let attempt = 0;
    let last;
    for (let i = 0; i < 10; i++) {
        last = decideReconnect({
            autoReconnect: true,
            error: { code: 'timeout', message: 'timeout' },
            attempt,
            maxAttempts: 3,
            backoff: { random: () => 0.5, baseMs: 10, maxMs: 50 }
        });
        if (last.action !== 'retry') break;
        attempt = last.nextAttempt;
    }
    assert.equal(last.action, 'exhausted');
    assert.ok(attempt <= 3);
});

test('user stop / thermal / profile change cancel retries', () => {
    assert.equal(
        decideReconnect({
            autoReconnect: true,
            userStopped: true,
            error: { code: 'timeout' }
        }).action,
        'stop'
    );
    assert.equal(
        decideReconnect({
            autoReconnect: true,
            thermalCritical: true,
            error: { code: 'timeout' }
        }).action,
        'stop'
    );
    assert.equal(
        decideReconnect({
            autoReconnect: true,
            profileChanged: true,
            error: { code: 'timeout' }
        }).action,
        'stop'
    );
});

test('failover refuses wallet/coin/TLS downgrade', () => {
    const active = {
        url: 'pool.a:3333',
        wallet: '4AAA',
        payoutCoin: 'monero',
        tls: true,
        protocol: 'stratum'
    };
    assert.equal(
        canFailoverTo(active, {
            url: 'pool.b:3333',
            wallet: '4BBB',
            payoutCoin: 'monero',
            tls: true
        }).ok,
        false
    );
    assert.equal(
        canFailoverTo(active, {
            url: 'pool.b:3333',
            wallet: '4AAA',
            payoutCoin: 'wownero',
            tls: true
        }).ok,
        false
    );
    assert.equal(
        canFailoverTo(active, {
            url: 'pool.b:3333',
            wallet: '4AAA',
            payoutCoin: 'monero',
            tls: false
        }).ok,
        false
    );
    assert.equal(
        canFailoverTo(active, {
            url: 'pool.b:3333',
            wallet: '4AAA',
            payoutCoin: 'monero',
            tls: true
        }).ok,
        true
    );
});

test('all backups exhausted or cooling down', () => {
    const active = { wallet: '4A', payoutCoin: 'monero', tls: true, protocol: 'stratum' };
    const now = 1_000_000;
    const r = nextFailover(
        active,
        [
            { id: 'b1', url: 'a:1', wallet: '4A', payoutCoin: 'monero', tls: true },
            { id: 'b2', url: 'b:1', wallet: '4A', payoutCoin: 'monero', tls: true }
        ],
        { now, cooldownUntil: { b1: now + 5000, b2: now + 5000 } }
    );
    assert.equal(r.ok, false);
});

test('classify separates fatal auth from retryable network', () => {
    assert.equal(classifyFailure({ message: 'login error' }).retryable, false);
    assert.equal(classifyFailure({ code: 'econnreset' }).retryable, true);
});
