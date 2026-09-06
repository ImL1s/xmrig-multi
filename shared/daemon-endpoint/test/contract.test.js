'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseDaemonEndpoint, DEFAULT_PORT } = require('../js/parse.js');
const { evaluateDaemonFixture, STAGES } = require('../js/probe.js');

const fixturesDir = path.join(__dirname, '..', 'fixtures');

function loadFixture(name) {
    return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'));
}

describe('parseDaemonEndpoint (#44)', () => {
    it('parses host:port', () => {
        const r = parseDaemonEndpoint('192.168.1.10:18081');
        assert.equal(r.ok, true);
        assert.equal(r.endpoint.host, '192.168.1.10');
        assert.equal(r.endpoint.port, 18081);
        assert.equal(r.endpoint.engineUrl, '192.168.1.10:18081');
        assert.equal(r.endpoint.isLoopback, false);
    });

    it('defaults port when omitted', () => {
        const r = parseDaemonEndpoint('10.0.0.5');
        assert.equal(r.ok, true);
        assert.equal(r.endpoint.port, DEFAULT_PORT);
        assert.equal(r.endpoint.engineUrl, `10.0.0.5:${DEFAULT_PORT}`);
    });

    it('parses http URI with path', () => {
        const r = parseDaemonEndpoint('http://monerod.local:18089/json_rpc');
        assert.equal(r.ok, true);
        assert.equal(r.endpoint.host, 'monerod.local');
        assert.equal(r.endpoint.port, 18089);
        assert.equal(r.endpoint.path, '/json_rpc');
        assert.equal(r.endpoint.engineUrl, 'monerod.local:18089');
    });

    it('parses bracketed IPv6 with port', () => {
        const r = parseDaemonEndpoint('[2001:db8::1]:18081');
        assert.equal(r.ok, true);
        assert.equal(r.endpoint.host, '2001:db8::1');
        assert.equal(r.endpoint.engineUrl, '[2001:db8::1]:18081');
    });

    it('parses http://[ipv6]:port', () => {
        const r = parseDaemonEndpoint('http://[::1]:18081');
        assert.equal(r.ok, true);
        assert.equal(r.endpoint.isLoopback, true);
        assert.equal(r.endpoint.engineUrl, '[::1]:18081');
    });

    it('rejects https when unsupported', () => {
        const r = parseDaemonEndpoint('https://node.example:18081');
        assert.equal(r.ok, false);
        assert.equal(r.code, 'https_unsupported');
    });

    it('does not rewrite https to http', () => {
        const r = parseDaemonEndpoint('https://192.168.1.10:18081');
        assert.equal(r.ok, false);
        assert.notEqual(r.endpoint?.engineUrl, '192.168.1.10:18081');
    });

    it('rejects illegal port range without fallback', () => {
        const r = parseDaemonEndpoint('192.168.1.10:99999');
        assert.equal(r.ok, false);
        assert.equal(r.code, 'port');
    });

    it('rejects empty port', () => {
        assert.equal(parseDaemonEndpoint('host:').ok, false);
    });

    it('rejects whitespace', () => {
        assert.equal(parseDaemonEndpoint('192.168.1.10: 18081').ok, false);
        assert.equal(parseDaemonEndpoint(' 192.168.1.10:18081 ').ok, true); // trim ends ok
        assert.equal(parseDaemonEndpoint('192.168.1.10 :18081').ok, false);
    });

    it('rejects IDN / non-ASCII host', () => {
        const r = parseDaemonEndpoint('http://例え.jp:18081');
        assert.equal(r.ok, false);
        assert.equal(r.code, 'idn');
    });

    it('strips userinfo from engineUrl', () => {
        const r = parseDaemonEndpoint('http://user:secret@10.0.0.2:18081/json_rpc');
        assert.equal(r.ok, true);
        assert.equal(r.endpoint.hasUserinfo, true);
        assert.equal(r.endpoint.engineUrl, '10.0.0.2:18081');
        assert.ok(!JSON.stringify(r).includes('secret'));
    });

    it('rejects bare IPv6 without brackets', () => {
        const r = parseDaemonEndpoint('2001:db8::1:18081');
        assert.equal(r.ok, false);
        assert.equal(r.code, 'ipv6');
    });

    it('rejects unknown schemes', () => {
        assert.equal(parseDaemonEndpoint('ftp://host:18081').ok, false);
        assert.equal(parseDaemonEndpoint('stratum+tcp://host:3333').ok, false);
    });

    it('marks loopback forms', () => {
        assert.equal(parseDaemonEndpoint('127.0.0.1:18081').endpoint.isLoopback, true);
        assert.equal(parseDaemonEndpoint('localhost').endpoint.isLoopback, true);
    });

    it('does not silent-fallback on bad host', () => {
        const r = parseDaemonEndpoint('http://:18081');
        assert.equal(r.ok, false);
    });
});

describe('evaluateDaemonFixture (#44)', () => {
    it('ready mainnet is readyToMine', () => {
        const r = evaluateDaemonFixture(loadFixture('ready-mainnet.json'));
        assert.equal(r.readyToMine, true);
        assert.equal(r.stage, 'mining_auth');
        assert.equal(r.code, 'ready');
    });

    it('syncing is not ready', () => {
        const r = evaluateDaemonFixture(loadFixture('syncing.json'));
        assert.equal(r.readyToMine, false);
        assert.equal(r.stage, 'sync');
        assert.equal(r.code, 'syncing');
    });

    it('wrong network is not ready', () => {
        const r = evaluateDaemonFixture(loadFixture('wrong-network.json'));
        assert.equal(r.readyToMine, false);
        assert.equal(r.stage, 'network');
    });

    it('restricted rpc is not ready', () => {
        const r = evaluateDaemonFixture(loadFixture('restricted-rpc.json'));
        assert.equal(r.readyToMine, false);
        assert.equal(r.code, 'restricted_rpc');
    });

    it('auth denied', () => {
        const r = evaluateDaemonFixture(loadFixture('auth-denied.json'));
        assert.equal(r.readyToMine, false);
        assert.equal(r.code, 'auth_denied');
    });

    it('tls failure', () => {
        const r = evaluateDaemonFixture(loadFixture('tls-fail.json'));
        assert.equal(r.stage, 'tls');
    });

    it('non-rpc service', () => {
        const r = evaluateDaemonFixture(loadFixture('non-rpc.json'));
        assert.equal(r.code, 'not_rpc');
    });

    it('tcp success alone is not ready', () => {
        // Fixture with only tcp implied — empty result is not ready
        const r = evaluateDaemonFixture({ result: {} });
        assert.equal(r.readyToMine, false);
        assert.ok(STAGES.includes(r.stage));
    });
});
