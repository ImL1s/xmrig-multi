/**
 * Diagnostics contract tests (#55).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_CATALOG, inferErrorCode, mapError } from '../js/errors.js';
import { RingBuffer } from '../js/ring-buffer.js';
import { redactText, redactValue } from '../js/redact.js';
import { buildDiagnosticPack } from '../js/pack.js';
import { SessionHistory } from '../js/session-history.js';

const WALLET = '8AfUwcnoJiRDMXnDGj3zX6bMgfaj9pM1WFGr2pakLm3jSYXVLD5fcDMBzkmk4AeSqWYQTA5aerXJ43W65AT82RMqG6NDBnC';

test('catalog codes map deterministically', () => {
    for (const code of Object.keys(ERROR_CATALOG)) {
        const m = mapError(code, 'raw');
        assert.equal(m.known, true);
        assert.equal(m.code, code);
        assert.ok(m.actions.length >= 1);
        assert.ok(!m.actions.includes('reinstall-antivirus-only'));
    }
    const unknown = mapError('NOPE', 'weird backend line');
    assert.equal(unknown.known, false);
    assert.equal(unknown.rawMessage, 'weird backend line');
    assert.ok(unknown.actions.includes('copy-raw'));
});

test('inferErrorCode covers required families', () => {
    assert.equal(inferErrorCode('invalid wallet address'), 'BAD_WALLET');
    assert.equal(inferErrorCode('TLS handshake failed'), 'TLS_HANDSHAKE');
    assert.equal(inferErrorCode('login failed unauthorized'), 'POOL_AUTH');
    assert.equal(inferErrorCode('unsupported algorithm rx/foo'), 'UNSUPPORTED_ALGORITHM');
    assert.equal(inferErrorCode('XMRig binary not found'), 'NATIVE_BINARY_MISSING');
    assert.equal(inferErrorCode('ABI mismatch elf class'), 'ABI_MISMATCH');
    assert.equal(inferErrorCode('cannot allocate RandomX memory'), 'MEMORY');
    assert.equal(inferErrorCode('thermal pause overheat'), 'THERMAL');
    assert.equal(inferErrorCode('FGS start not allowed quota'), 'BACKGROUND_RESTRICTED');
    assert.equal(inferErrorCode('connection timeout dns'), 'NETWORK');
});

test('ring buffer caps capacity and supports search without forcing follow', () => {
    const buf = new RingBuffer(100);
    for (let i = 0; i < 250; i++) {
        buf.push({ level: 'info', message: `line-${i}`, code: i % 2 ? 'NETWORK' : 'TLS_HANDSHAKE' });
    }
    assert.equal(buf.size(), 100);
    assert.equal(buf.dropped, 150);
    buf.followTail = false;
    const hits = buf.query({ query: 'line-240', level: 'info' });
    assert.equal(hits.length, 1);
    assert.equal(buf.followTail, false);
});

test('100k pushes stay within capacity', () => {
    const buf = new RingBuffer(1000);
    for (let i = 0; i < 100_000; i++) buf.push({ message: String(i) });
    assert.equal(buf.size(), 1000);
    assert.ok(buf.dropped >= 99_000);
});

test('redaction masks wallet token password seed uri userinfo', () => {
    const raw = [
        `wallet=${WALLET}`,
        'password=super-secret',
        'api_token=abcdef0123456789abcdef0123456789',
        'stratum+tcp://user:pass@pool.example:3333',
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    ].join('\n');
    const red = redactText(raw);
    assert.ok(!red.includes(WALLET));
    assert.ok(red.includes('…'));
    assert.ok(red.includes('password=***'));
    assert.ok(red.includes('api_token=***') || red.includes('[token-redacted]'));
    assert.ok(red.includes('***@'));
    assert.ok(red.includes('[seed-redacted]'));
    assert.ok(!/super-secret/.test(red));
    assert.ok(!/hunter2/.test(red));
    assert.ok(!/0123456789abcdef0123456789abcdef/.test(red));
});

test('diagnostic pack preview is redacted and never auto-uploads', () => {
    const { preview, payload } = buildDiagnosticPack({
        events: [{ message: `mining as ${WALLET}`, code: 'NETWORK' }],
        sessions: [{ sessionId: 's1', stopReason: 'user' }],
        meta: { walletAddress: WALLET, apiToken: 'abcdef0123456789abcdef0123456789' }
    });
    assert.equal(preview.autoUpload, false);
    assert.equal(preview.redacted, true);
    assert.ok(!JSON.stringify(payload).includes(WALLET));
    assert.ok(!JSON.stringify(payload).includes('abcdef0123456789abcdef0123456789'));
});

test('session history retains last stop reason across capacity', () => {
    const h = new SessionHistory(3);
    h.record({ sessionId: '1', startedAt: 't1', stopReason: 'network' });
    h.record({ sessionId: '2', startedAt: 't2', stopReason: 'user' });
    h.record({ sessionId: '3', startedAt: 't3', stopReason: 'thermal' });
    h.record({ sessionId: '4', startedAt: 't4', stoppedAt: 't4b', stopReason: 'background' });
    assert.equal(h.list().length, 3);
    assert.equal(h.last().sessionId, '4');
    assert.equal(h.last().stopReason, 'background');
});

test('redactValue fuzz-ish mixed objects', () => {
    const out = redactValue({
        nested: { spendKey: 'aabb', ok: true },
        list: [`${WALLET}`, 'safe']
    });
    assert.equal(out.nested.spendKey, '[redacted]');
    assert.ok(!JSON.stringify(out).includes(WALLET));
});
