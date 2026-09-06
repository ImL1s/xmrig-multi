import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    loadRegistry,
    validateRegistry,
    toAndroidPoolsJson,
    toDesktopPoolConfigs
} from '../js/load.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('registry.v1.json validates', () => {
    const { registry, hash } = loadRegistry();
    assert.equal(registry.schemaVersion, 1);
    assert.ok(registry.entries.length >= 8);
    assert.equal(hash.length, 64);
});

test('every legacy Android preset id is present with explicit status', () => {
    const { registry } = loadRegistry();
    const ids = new Set(registry.entries.map((e) => e.id));
    for (const id of [
        'supportxmr',
        'hashvault',
        'moneroocean',
        'c3pool',
        'herominers-wow',
        'cryptoknight-wow',
        'dero-official-node',
        'dero-community-node'
    ]) {
        assert.ok(ids.has(id), id);
    }
    for (const e of registry.entries) {
        assert.ok(e.status, e.id);
        assert.ok(e.disposition, e.id);
        assert.ok(e.lastReviewedAt, e.id);
    }
});

test('unknown fees never encode percent 0 as known', () => {
    const { registry } = loadRegistry();
    for (const e of registry.entries) {
        const fee = e.fees.poolFee;
        if (fee.status === 'unknown') {
            assert.equal(fee.percent, null, e.id);
        }
    }
    const android = toAndroidPoolsJson(registry);
    for (const p of android) {
        if (p.registry_status !== 'verified') {
            assert.notEqual(p.fee, '0%', `${p.id} must not fake 0%`);
        }
    }
});

test('kinds are not mixed (dero-node vs stratum-pool)', () => {
    const { registry } = loadRegistry();
    const dero = registry.entries.filter((e) => e.miningChain === 'dero');
    for (const e of dero) {
        assert.equal(e.kind, 'dero-node');
        assert.equal(e.status, 'unavailable');
    }
    const stratum = registry.entries.filter((e) => e.kind === 'stratum-pool');
    for (const e of stratum) {
        assert.notEqual(e.miningChain, 'dero');
    }
});

test('novice defaults are only docs/protocol verified Monero', () => {
    const { registry } = loadRegistry();
    const novices = registry.entries.filter((e) => e.noviceDefault);
    assert.ok(novices.length >= 1);
    for (const e of novices) {
        assert.ok(['verified', 'docs-verified'].includes(e.status), e.id);
        assert.equal(e.miningChain, 'monero');
        assert.equal(e.payoutAsset, 'XMR');
    }
});

test('c3pool 23333 is not marked TLS', () => {
    const { registry } = loadRegistry();
    const c3 = registry.entries.find((e) => e.id === 'c3pool');
    const ep = c3.endpoints.find((x) => x.port === 23333);
    assert.ok(ep);
    assert.equal(ep.tls, false);
    assert.equal(ep.transport, 'stratum-tcp');
});

test('android + desktop adapters stay in sync with registry hash file when generated', () => {
    const { registry, hash } = loadRegistry();
    const android = toAndroidPoolsJson(registry);
    assert.equal(android.find((p) => p.id === 'moneroocean').payout_asset, 'XMR');
    assert.equal(android.find((p) => p.id === 'c3pool').status, 'unverified');
    const desktop = toDesktopPoolConfigs(registry);
    assert.ok(desktop.monero.some((p) => p.id === 'supportxmr'));
    assert.ok(desktop.wownero.every((p) => p.status === 'unavailable' || p.registry_status === 'unavailable'));
    assert.equal(hash.length, 64);
});

test('validate rejects fee percent on unknown', () => {
    const { registry } = loadRegistry();
    const bad = structuredClone(registry);
    bad.entries[0].fees.poolFee = { status: 'unknown', percent: 0, asOf: null, note: '' };
    const v = validateRegistry(bad);
    assert.equal(v.ok, false);
});

test('checked-in Android pools.json matches generator output', () => {
    const { registry } = loadRegistry();
    const expected = toAndroidPoolsJson(registry);
    const actual = JSON.parse(
        readFileSync(join(root, '..', '..', 'app', 'src', 'main', 'assets', 'pools.json'), 'utf8')
    );
    assert.deepEqual(actual, expected);
});

test('checked-in desktop generated-pool-configs matches generator', () => {
    const { registry, hash } = loadRegistry();
    const expected = {
        schemaVersion: 1,
        registryHash: hash,
        generatedAt: registry.generatedAt,
        poolConfigs: toDesktopPoolConfigs(registry)
    };
    const actual = JSON.parse(
        readFileSync(join(root, '..', '..', 'desktop', 'src', 'generated-pool-configs.json'), 'utf8')
    );
    assert.deepEqual(actual, expected);
});
