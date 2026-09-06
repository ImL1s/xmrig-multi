/**
 * MiningProfile contract tests (#30).
 * Run from repo: node --test shared/mining-profile/test/*.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../js/compile.js';
import { migrateToV1, validateMiningProfile } from '../js/validate.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (name) => JSON.parse(readFileSync(join(root, 'fixtures', name), 'utf8'));

const CAPS_XMRIG = {
    platform: 'android',
    backend: 'xmrig',
    tls: true,
    coins: {
        monero: { status: 'supported' },
        wownero: { status: 'unavailable', reason: 'blocked (#28)' },
        dero: { status: 'unavailable', reason: 'blocked (#27)' }
    }
};

const HW = { logicalCpus: 8 };

test('valid fixtures pass schema validation', () => {
    for (const name of ['profile-android-manual.json', 'profile-web-auto.json']) {
        const v = validateMiningProfile(fixture(name));
        assert.equal(v.ok, true, name + ': ' + (v.errors || []).join('; '));
    }
});

test('manual profile compiles to -t argv and omits max-threads-hint', () => {
    const result = compile(fixture('profile-android-manual.json'), CAPS_XMRIG, HW);
    assert.equal(result.ok, true);
    assert.equal(result.resolved.cpu.mode, 'manual');
    assert.equal(result.resolved.cpu.threads, 4);
    assert.equal(result.resolved.cpu.maxThreadsHintPercent, null);
    assert.ok(result.native.argv.includes('-t'));
    assert.ok(result.native.argv.includes('4'));
    assert.equal(result.native.json.cpu['max-threads-hint'], undefined);
    assert.equal(result.sources['cpu.threads'], 'user-lock');
    assert.equal(result.effective.fields['runtime.threads'].confidence, 'unknown');
});

test('auto profile uses hint and never puts threads in argv', () => {
    const result = compile(fixture('profile-web-auto.json'), {
        platform: 'web',
        backend: 'randomx-js',
        tls: true,
        coins: { monero: { status: 'supported' } }
    }, { logicalCpus: 4 });
    assert.equal(result.ok, true);
    assert.equal(result.resolved.cpu.mode, 'auto');
    assert.equal(result.resolved.cpu.threads, null);
    assert.equal(result.resolved.cpu.maxThreadsHintPercent, 50);
    assert.equal(result.native.argv.includes('-t'), false);
    assert.equal(result.native.json.cpu['max-threads-hint'], 50);
});

test('legacy Android shape migrates without wiping wallet/pool', () => {
    const legacy = fixture('legacy-android-shape.json');
    const migrated = migrateToV1(legacy);
    assert.equal(migrated.schemaVersion, 1);
    assert.equal(migrated.coin, 'monero');
    assert.equal(migrated.payoutAsset, 'XMR');
    assert.equal(migrated.endpoint.url, legacy.poolUrl);
    assert.equal(migrated.account.user, legacy.walletAddress);
    assert.equal(migrated.cpu.mode, 'auto');
    assert.equal(migrated.cpu.threads, null);
    assert.equal(migrated.cpu.maxThreadsHintPercent, 75);
    assert.equal(migrated.endpoint.tls, true);
});

test('future schemaVersion is refused (no silent reset)', () => {
    assert.throws(() => migrateToV1({ schemaVersion: 99, id: 'x' }), /future schemaVersion/);
    const blocked = compile({ schemaVersion: 99, id: 'x' }, CAPS_XMRIG, HW);
    assert.equal(blocked.ok, false);
    assert.match(blocked.blocked.reason, /schemaVersion|future|refuse/i);
});

test('invalid/unsupported fields produce reasons; unknown keys warn', () => {
    const bad = {
        ...fixture('profile-android-manual.json'),
        cpu: { mode: 'manual', threads: null },
        totallyUnknown: true
    };
    const v = validateMiningProfile(migrateToV1(bad));
    // migrate may leave threads null for manual if we pass through — validate should fail
    const profile = {
        ...fixture('profile-android-manual.json'),
        cpu: { mode: 'manual', threads: null, maxThreadsHintPercent: null, affinity: null },
        spooky: 1
    };
    const invalid = validateMiningProfile(profile);
    assert.equal(invalid.ok, false);
    assert.ok(invalid.errors.some((e) => e.includes('threads')));

    const withUnknown = { ...fixture('profile-android-manual.json'), spooky: 1 };
    const compiled = compile(withUnknown, CAPS_XMRIG, HW);
    assert.equal(compiled.ok, true);
    assert.ok(compiled.warnings.some((w) => w.code === 'unknown_key' && w.field === 'spooky'));
});

test('safety blocks WOW on xmrig when capability unavailable', () => {
    const wow = {
        ...fixture('profile-android-manual.json'),
        coin: 'wownero',
        payoutAsset: 'WOW',
        endpoint: {
            type: 'stratum',
            url: 'wownero.herominers.com:1111',
            tls: false,
            poolId: 'herominers-wow'
        }
    };
    const result = compile(wow, CAPS_XMRIG, HW);
    assert.equal(result.ok, false);
    assert.match(result.blocked.reason, /#28|unavailable|Wownero/i);
});

test('MoneroOcean non-XMR payout blocked (#29)', () => {
    const p = {
        ...fixture('profile-android-manual.json'),
        payoutAsset: 'WOW',
        endpoint: {
            type: 'stratum',
            url: 'gulf.moneroocean.stream:10128',
            tls: false,
            poolId: 'moneroocean'
        }
    };
    const result = compile(p, CAPS_XMRIG, HW);
    assert.equal(result.ok, false);
    assert.match(result.blocked.reason, /MoneroOcean|#29/);
});

test('TLS locked but runtime without TLS blocks; unlocked falls back', () => {
    const locked = {
        ...fixture('profile-android-manual.json'),
        endpoint: {
            type: 'stratum',
            url: 'pool.supportxmr.com:443',
            tls: true,
            poolId: 'supportxmr'
        },
        locks: { fields: ['endpoint.tls'] }
    };
    const blocked = compile(locked, { ...CAPS_XMRIG, tls: false }, HW);
    assert.equal(blocked.ok, false);

    const unlocked = {
        ...locked,
        locks: { fields: [] }
    };
    const ok = compile(unlocked, { ...CAPS_XMRIG, tls: false }, HW);
    assert.equal(ok.ok, true);
    assert.equal(ok.resolved.endpoint.tls, false);
    assert.equal(ok.sources['endpoint.tls'], 'safety');
});

test('accepted-tune priority below user lock, above fallback', () => {
    const base = {
        ...fixture('profile-web-auto.json'),
        cpu: { mode: 'auto', threads: null, maxThreadsHintPercent: null, affinity: null },
        locks: { fields: [] }
    };
    const tuned = compile(base, {
        platform: 'web',
        backend: 'randomx-js',
        tls: true,
        coins: { monero: { status: 'supported' } },
        acceptedTune: { cpu: { maxThreadsHintPercent: 40 } }
    }, { logicalCpus: 4 });
    assert.equal(tuned.resolved.cpu.maxThreadsHintPercent, 40);
    assert.equal(tuned.sources['cpu.maxThreadsHintPercent'], 'accepted-tune');

    const lockedHint = {
        ...base,
        cpu: { mode: 'auto', threads: null, maxThreadsHintPercent: 60, affinity: null },
        locks: { fields: ['cpu.maxThreadsHintPercent'] }
    };
    const locked = compile(lockedHint, {
        platform: 'web',
        backend: 'randomx-js',
        tls: true,
        coins: { monero: { status: 'supported' } },
        acceptedTune: { cpu: { maxThreadsHintPercent: 40 } }
    }, { logicalCpus: 4 });
    assert.equal(locked.resolved.cpu.maxThreadsHintPercent, 60);
    assert.equal(locked.sources['cpu.maxThreadsHintPercent'], 'user-lock');
});

test('autoReconnect false forces XMRig retries to 0 (#43)', () => {
    const profile = {
        ...fixture('profile-android-manual.json'),
        network: { autoReconnect: false, retries: 5, retryPauseSec: 5 }
    };
    const out = compile(profile, CAPS_XMRIG, HW);
    assert.equal(out.ok, true);
    assert.equal(out.native.json.retries, 0);
});

test('native argv is structured list (no shell join) and revision is stable', () => {
    const a = compile(fixture('profile-android-manual.json'), CAPS_XMRIG, HW);
    const b = compile(fixture('profile-android-manual.json'), CAPS_XMRIG, HW);
    assert.equal(a.revision, b.revision);
    assert.ok(Array.isArray(a.native.argv));
    assert.equal(a.native.argv.some((x) => String(x).includes(' && ')), false);
});

test('public field mapping: Android MiningConfig-like keys → profile paths', () => {
    /** @type {Record<string, string>} */
    const mapping = {
        poolUrl: 'endpoint.url',
        walletAddress: 'account.user',
        workerName: 'account.pass',
        threads: 'cpu.threads',
        threadsAuto: 'cpu.mode',
        maxCpuUsage: 'cpu.maxThreadsHintPercent',
        useTls: 'endpoint.tls',
        donateLevel: 'donateLevel',
        coinType: 'coin'
    };
    const legacy = fixture('legacy-android-shape.json');
    const migrated = migrateToV1(legacy);
    for (const [from, to] of Object.entries(mapping)) {
        assert.ok(from in legacy, `legacy has ${from}`);
        const parts = to.split('.');
        let cur = migrated;
        for (const p of parts) {
            cur = cur[p];
        }
        assert.notEqual(cur, undefined, `${from} → ${to}`);
    }
    // soloDaemon / autoReconnect aliases also migrate when present
    const solo = migrateToV1({ ...legacy, soloDaemon: true, autoReconnect: false });
    assert.equal(solo.endpoint.type, 'daemon');
    assert.equal(solo.network.autoReconnect, false);
    assert.equal(migrated.cpu.mode, 'auto');
    assert.equal(migrated.endpoint.type, 'stratum');
});
