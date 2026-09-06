/**
 * Proxy resolution / diagnostics tests (#50).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    diagnoseProxyFailure,
    isLoopbackHost,
    resolveProxyEndpoint,
    testProxyHandshake,
    validateProxyUrl
} from '../js/proxy-config.js';

test('#50 public HTTPS never implies visitor localhost proxy', () => {
    const r = resolveProxyEndpoint(
        { protocol: 'https:', hostname: 'miner.example.com', host: 'miner.example.com', port: '' },
        { allowDevLocalhostDefault: true }
    );
    assert.equal(r.ok, false);
    assert.equal(r.code, 'missing_config');
    assert.equal(r.url, null);
});

test('#50 localhost dev may suggest local proxy but must be explicit source', () => {
    const r = resolveProxyEndpoint(
        { protocol: 'http:', hostname: 'localhost', host: 'localhost:5173', port: '5173' },
        {}
    );
    assert.equal(r.ok, true);
    assert.equal(r.source, 'dev-default');
    assert.equal(r.url, 'ws://127.0.0.1:3333');
    assert.equal(r.visibleRequired, true);
});

test('#50 HTTPS page rejects ws:// (no TLS downgrade)', () => {
    const v = validateProxyUrl('ws://proxy.example.com/ws', { protocol: 'https:', hostname: 'app.example.com' });
    assert.equal(v.ok, false);
    assert.equal(v.code, 'tls_downgrade');
});

test('#50 deployment proxyUrl wins and marks remote trust', () => {
    const r = resolveProxyEndpoint(
        { protocol: 'https:', hostname: 'app.example.com', host: 'app.example.com', port: '' },
        { proxyUrl: 'wss://proxy.example.com/ws', trustNotice: 'fee notice' }
    );
    assert.equal(r.ok, true);
    assert.equal(r.source, 'deployment');
    assert.equal(r.requiresRemoteConfirm, true);
    assert.equal(r.trustNotice, 'fee notice');
});

test('#50 sameOriginPath builds wss on https host', () => {
    const r = resolveProxyEndpoint(
        { protocol: 'https:', hostname: 'app.example.com', host: 'app.example.com', port: '' },
        { sameOriginPath: '/mining-ws' }
    );
    assert.equal(r.ok, true);
    assert.equal(r.url, 'wss://app.example.com/mining-ws');
    assert.equal(r.kind, 'same-origin');
});

test('#50 LAN http suggests same-host proxy', () => {
    const r = resolveProxyEndpoint(
        { protocol: 'http:', hostname: '192.168.1.10', host: '192.168.1.10', port: '' },
        {}
    );
    assert.equal(r.ok, true);
    assert.equal(r.source, 'lan-suggest');
    assert.equal(r.url, 'ws://192.168.1.10:3333');
});

test('#50 diagnose mixed content vs offline', () => {
    const mixed = diagnoseProxyFailure({
        pageProtocol: 'https:',
        proxyUrl: 'ws://127.0.0.1:3333'
    });
    assert.equal(mixed.layer, 'mixed_content');
    const offline = diagnoseProxyFailure({ code: 1006 });
    assert.equal(offline.layer, 'proxy_offline');
});

test('#50 handshake probe resolves open/timeout without wallet', async () => {
    class FakeWS {
        static OPEN_OK = true;
        constructor() {
            queueMicrotask(() => {
                if (FakeWS.OPEN_OK && this.onopen) this.onopen();
                else if (this.onerror) this.onerror(new Error('fail'));
            });
        }
        close() {}
    }
    const ok = await testProxyHandshake('ws://127.0.0.1:9', { WebSocketImpl: FakeWS, timeoutMs: 200 });
    assert.equal(ok.ok, true);

    FakeWS.OPEN_OK = false;
    class TimeoutWS {
        constructor() { this.readyState = 0; }
        close() {}
    }
    const timed = await testProxyHandshake('ws://127.0.0.1:9', { WebSocketImpl: TimeoutWS, timeoutMs: 50 });
    assert.equal(timed.ok, false);
    assert.equal(timed.layer, 'proxy_offline');
});

test('loopback helper', () => {
    assert.equal(isLoopbackHost('127.0.0.1'), true);
    assert.equal(isLoopbackHost('miner.example.com'), false);
});
