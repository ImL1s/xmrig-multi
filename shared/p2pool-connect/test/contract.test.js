import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    parseP2PoolStratumEndpoint,
    parseMonerodRpcEndpoint,
    buildP2PoolMinerConfig,
    evaluateFixture,
    P2POOL_DEFAULTS
} from '../js/connect.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(ROOT, 'fixtures');

test('stratum parse never implies daemon:true and rejects RPC-looking URLs', () => {
    const ok = parseP2PoolStratumEndpoint('127.0.0.1:3333');
    assert.equal(ok.ok, true);
    assert.equal(ok.xmrigPool.daemon, false);
    assert.equal(ok.port, 3333);

    const lan = parseP2PoolStratumEndpoint('192.168.1.10');
    assert.equal(lan.ok, true);
    assert.equal(lan.port, 3333);
    assert.equal(lan.trust, 'lan');

    assert.equal(parseP2PoolStratumEndpoint('http://127.0.0.1:18081/json_rpc').code, 'looks_like_rpc');
    assert.equal(parseP2PoolStratumEndpoint('8.8.8.8:3333').code, 'untrusted_host');
});

test('monerod RPC is a separate role from Stratum', () => {
    const rpc = parseMonerodRpcEndpoint('127.0.0.1:18081');
    assert.equal(rpc.ok, true);
    assert.equal(rpc.role, 'monerod-rpc');
    assert.equal(rpc.port, 18081);
    assert.match(rpc.url, /json_rpc/);
    assert.notEqual(rpc.port, P2POOL_DEFAULTS.stratumPort);
});

test('buildP2PoolMinerConfig keeps daemon false and documents fees', () => {
    const stratum = parseP2PoolStratumEndpoint('10.0.0.5:3333');
    const wallet = '4' + 'A'.repeat(94);
    const cfg = buildP2PoolMinerConfig({ stratum, wallet, sidechain: 'mini' });
    assert.equal(cfg.ok, true);
    assert.equal(cfg.pool.daemon, false);
    assert.equal(cfg.managedServices, false);
    assert.ok(cfg.fees.sources.length >= 1);
    assert.match(cfg.fees.note, /Not a payment guarantee/i);
});

test('fixtures: only ready stack reports readyToMine', () => {
    for (const name of readdirSync(FIX).filter((f) => f.endsWith('.json'))) {
        const fixture = JSON.parse(readFileSync(join(FIX, name), 'utf8'));
        const ev = evaluateFixture(fixture);
        if (name.startsWith('ready')) {
            assert.equal(ev.readyToMine, true, name);
        } else {
            assert.equal(ev.readyToMine, false, name);
        }
    }
});
