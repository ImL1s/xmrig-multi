/**
 * Daemon endpoint parse + preflight tests (#44).
 * Run: node --test shared/daemon-endpoint/test/*.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDaemonEndpoint } from '../js/parse.js';
import { preflightDaemon } from '../js/preflight.js';

test('parses bare host:port', () => {
    const p = parseDaemonEndpoint('192.168.1.10:18089');
    assert.equal(p.ok, true);
    assert.equal(p.host, '192.168.1.10');
    assert.equal(p.port, 18089);
    assert.equal(p.engineUrl, '192.168.1.10:18089');
});

test('http://host:port must not become host "http"', () => {
    const p = parseDaemonEndpoint('http://monerod.local:18081');
    assert.equal(p.ok, true);
    assert.equal(p.host, 'monerod.local');
    assert.equal(p.port, 18081);
    assert.equal(p.scheme, 'http');
    assert.notEqual(p.host, 'http');
});

test('https rejected when TLS unsupported', () => {
    const p = parseDaemonEndpoint('https://node.example:18081', { allowHttps: false });
    assert.equal(p.ok, false);
    assert.equal(p.code, 'tls_unsupported');
});

test('IPv6 with brackets and port', () => {
    const p = parseDaemonEndpoint('[2001:db8::1]:18081');
    assert.equal(p.ok, true);
    assert.equal(p.host, '2001:db8::1');
    assert.equal(p.port, 18081);
    assert.equal(p.engineUrl, '[2001:db8::1]:18081');
});

test('illegal port is hard error — no silent 18081 fallback', () => {
    const p = parseDaemonEndpoint('node.example:99999');
    assert.equal(p.ok, false);
    assert.equal(p.code, 'bad_port');
});

test('omitted port defaults to 18081', () => {
    const p = parseDaemonEndpoint('127.0.0.1');
    assert.equal(p.ok, true);
    assert.equal(p.port, 18081);
    assert.equal(p.isLoopback, true);
});

test('userinfo stripped and flagged — not part of engine url', () => {
    const p = parseDaemonEndpoint('http://user:secret@192.168.0.5:18081/json_rpc');
    assert.equal(p.ok, true);
    assert.equal(p.hasUserinfo, true);
    assert.equal(p.host, '192.168.0.5');
    assert.ok(!p.engineUrl.includes('user'));
    assert.ok(!p.engineUrl.includes('secret'));
});

test('whitespace and empty fail', () => {
    assert.equal(parseDaemonEndpoint('').ok, false);
    assert.equal(parseDaemonEndpoint('   ').ok, false);
    assert.equal(parseDaemonEndpoint('host name:18081').ok, false);
});

test('TCP alone is not ready — rpc_required without transport', async () => {
    const r = await preflightDaemon('127.0.0.1:18081', {
        tcpConnect: async () => ({ ok: true })
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'rpc_required');
    assert.equal(r.tcpOnly, true);
});

test('syncing fixture fails with repair hint', async () => {
    const r = await preflightDaemon('http://10.0.0.2:18081', {
        tcpConnect: async () => ({ ok: true }),
        rpcCall: async () => ({
            result: { synchronized: false, height: 100, target_height: 999, nettype: 'mainnet' }
        })
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'syncing');
    assert.match(r.hint, /sync/i);
});

test('wrong network fixture', async () => {
    const r = await preflightDaemon('10.0.0.2:18081', {
        expectedNetwork: 0,
        tcpConnect: async () => ({ ok: true }),
        rpcCall: async () => ({
            result: { synchronized: true, nettype: 'testnet', height: 1 }
        })
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'wrong_network');
});

test('restricted RPC fixture', async () => {
    const r = await preflightDaemon('10.0.0.2:18081', {
        tcpConnect: async () => ({ ok: true }),
        rpcCall: async () => ({ error: { message: 'Forbidden — restricted RPC' } })
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'rpc_restricted');
});

test('ready when synchronized mainnet', async () => {
    const r = await preflightDaemon('http://10.0.0.2:18081', {
        expectedNetwork: 0,
        tcpConnect: async () => ({ ok: true }),
        rpcCall: async () => ({
            result: { synchronized: true, nettype: 'mainnet', height: 3_000_000, version: '0.18' }
        })
    });
    assert.equal(r.ok, true);
    assert.equal(r.stage, 'ready');
    assert.equal(r.parsed.engineUrl, '10.0.0.2:18081');
});

test('loopback TCP fail explains phone localhost', async () => {
    const r = await preflightDaemon('127.0.0.1:18081', {
        tcpConnect: async () => ({ ok: false, error: 'ECONNREFUSED' })
    });
    assert.equal(r.ok, false);
    assert.match(r.hint, /phone/i);
});
