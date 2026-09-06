/**
 * HardwareSnapshot contract tests (#33).
 * Run: node --test shared/hardware-capability/test/*.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeWebLikeHardware, validateHardwareSnapshot } from '../js/validate.js';
import { recommendFromHardware } from '../js/recommend.js';
import { sanitizeHardwareReport } from '../js/export.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = join(root, 'fixtures');
const fixture = (name) => JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));

const REQUIRED_FIXTURES = [
    'single-core.json',
    'smt.json',
    'intel-hybrid.json',
    'amd-multi-ccd.json',
    'arm-big-little.json',
    'apple-silicon.json',
    'vm-container-cpuset.json',
    'gt64-logical.json',
    'abi-32bit-unsupported.json',
    'windows-no-wmic.json'
];

test('required topology fixtures exist and validate', () => {
    const files = new Set(readdirSync(fixturesDir));
    for (const name of REQUIRED_FIXTURES) {
        assert.ok(files.has(name), `missing fixture ${name}`);
        const v = validateHardwareSnapshot(fixture(name));
        assert.equal(v.ok, true, `${name}: ${(v.errors || []).join('; ')}`);
        assert.equal(v.snapshot.evidenceKind, 'fixture');
    }
});

test('unknown memory/cache must not be fake 0', () => {
    const bad = fixture('apple-silicon.json');
    bad.memory.availableBytes = {
        value: 0,
        source: 'bug',
        timestamp: bad.capturedAt,
        confidence: 'unknown',
        unknownReason: 'not-probed'
    };
    const v = validateHardwareSnapshot(bad);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.includes('null value')));
});

test('recommender stays inside allowed cpuset and marks stale hints', () => {
    const snap = fixture('vm-container-cpuset.json');
    const rec = recommendFromHardware(snap);
    assert.equal(rec.maxThreads, 4);
    assert.ok(rec.recommendedThreads <= 4);
    assert.ok(rec.staleIf.includes('cpuset-change'));
    assert.equal(rec.affinitySafe, true);
});

test('SMT / hybrid prefer physical-aware conservative threads', () => {
    const smt = recommendFromHardware(fixture('smt.json'));
    assert.ok(smt.recommendedThreads <= 16);
    assert.ok(smt.reasons.length > 0);

    const hybrid = recommendFromHardware(fixture('intel-hybrid.json'));
    assert.ok(hybrid.recommendedThreads <= 20);
    assert.ok(hybrid.reasons.some((r) => /heterogeneous|SMT|physical/i.test(r)));
});

test('unsupported ABI yields zero threads with reason', () => {
    const rec = recommendFromHardware(fixture('abi-32bit-unsupported.json'));
    assert.equal(rec.recommendedThreads, 0);
    assert.equal(rec.maxThreads, 0);
    assert.ok(rec.reasons.some((r) => /ABI/i.test(r)));
});

test('single-core recommends 1 thread', () => {
    const rec = recommendFromHardware(fixture('single-core.json'));
    assert.equal(rec.maxThreads, 1);
    assert.equal(rec.recommendedThreads, 1);
});

test('gt64 logical fixture remains valid and caps recommendations', () => {
    const snap = fixture('gt64-logical.json');
    assert.equal(snap.cpu.logical.value, 128);
    const rec = recommendFromHardware(snap);
    assert.equal(rec.maxThreads, 128);
    assert.ok(rec.recommendedThreads <= 128);
});

test('windows missing wmic still opens with Win32 memory fields', () => {
    const snap = fixture('windows-no-wmic.json');
    assert.equal(snap.cpu.name.value, null);
    assert.equal(snap.memory.totalBytes.source, 'GlobalMemoryStatusEx');
    const rec = recommendFromHardware(snap);
    assert.ok(rec.recommendedThreads >= 1);
});

test('sanitize export strips hostname/mac/serial and keeps model facts', () => {
    const snap = fixture('smt.json');
    snap.hostname = 'DESKTOP-ALICE';
    snap.cpu.name.value = 'Ryzen 7 @DESKTOP-ALICE';
    snap.macAddresses = ['aa:bb:cc:dd:ee:ff'];
    const report = sanitizeHardwareReport(snap);
    assert.equal(report.redacted, true);
    assert.equal(report.snapshot.hostname, undefined);
    assert.equal(report.snapshot.macAddresses, undefined);
    assert.equal(report.snapshot.cpu.name.value.includes('@'), false);
    assert.match(JSON.stringify(report), /SMT Fixture|Ryzen/);
});

test('web-like probe never invents cache topology', () => {
    const snap = probeWebLikeHardware({ hardwareConcurrency: 8 }, { os: 'web', arch: 'x64', evidenceKind: 'live' });
    const v = validateHardwareSnapshot(snap);
    assert.equal(v.ok, true, (v.errors || []).join('; '));
    assert.equal(snap.cpu.cache.l3Bytes.value, null);
    assert.equal(snap.evidenceKind, 'live');
    const rec = recommendFromHardware(snap);
    assert.ok(rec.recommendedThreads <= 8);
    assert.ok(rec.confidence === 'low' || rec.confidence === 'medium' || rec.confidence === 'unknown');
});

test('live vs fixture evidence kinds stay distinct', () => {
    assert.equal(fixture('smt.json').evidenceKind, 'fixture');
    const live = probeWebLikeHardware({ hardwareConcurrency: 2 }, { evidenceKind: 'live' });
    assert.equal(live.evidenceKind, 'live');
});
