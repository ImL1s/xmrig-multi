/**
 * CPU topology / affinity contract tests (#36).
 * Run: node --test shared/cpu-topology/test/*.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { affinityCapability } from '../js/platform.js';
import {
    idsToMaskHex,
    parseCpuIdList,
    validateAffinity
} from '../js/affinity.js';
import { buildTopologyCandidates } from '../js/candidates.js';
import { resolveAffinityApply } from '../js/apply.js';
import { recomputeAffinityProfile } from '../js/recompute.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hwFixtures = join(root, '..', 'hardware-capability', 'fixtures');
const fixturesDir = join(root, 'fixtures');
const hw = (name) => JSON.parse(readFileSync(join(hwFixtures, name), 'utf8'));
const local = (name) => JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));

const REQUIRED = [
    'single-core.json',
    'arm-big-little.json',
    'intel-hybrid.json',
    'amd-multi-ccd.json',
    'gt64-logical.json',
    'vm-container-cpuset.json'
];

test('required hardware fixtures produce legal candidates', () => {
    for (const name of REQUIRED) {
        const snap = hw(name);
        const { candidates, affinity } = buildTopologyCandidates(snap);
        assert.ok(candidates.length >= 1, name);
        assert.equal(candidates[0].id, 'os-auto');
        assert.ok(candidates.every((c) => c.threads >= 1));
        if (snap.platform.os === 'android' || snap.platform.os === 'ios') {
            assert.equal(affinity.mode, 'soft');
            assert.ok(candidates.filter((c) => c.mode === 'affinity').length === 0);
        }
        if (snap.platform.os === 'linux' || snap.platform.os === 'windows') {
            assert.equal(affinity.canEmitXmrigAffinity, true);
        }
    }
});

test('Intel P/E and AMD CCD groups appear as candidates', () => {
    const intel = buildTopologyCandidates(hw('intel-hybrid.json'));
    assert.ok(intel.candidates.some((c) => /performance|p\b/i.test(c.id + c.label)));
    assert.ok(intel.candidates.some((c) => /efficiency|e\b/i.test(c.id + c.label)));

    const amd = buildTopologyCandidates(hw('amd-multi-ccd.json'));
    assert.ok(amd.candidates.some((c) => /ccd/i.test(c.id + c.groupKind)));
});

test('container cpuset caps candidates to allowed', () => {
    const { candidates } = buildTopologyCandidates(hw('vm-container-cpuset.json'));
    for (const c of candidates) {
        assert.ok(c.threads <= 4, c.id);
        if (c.cpuIds) assert.ok(c.cpuIds.every((id) => id < 4));
    }
});

test('gt64 logical stays valid without 32-bit mask truncation', () => {
    const snap = hw('gt64-logical.json');
    const applied = resolveAffinityApply({
        snapshot: snap,
        manualCpuIds: [0, 64, 127]
    });
    assert.equal(applied.ok, true);
    assert.equal(applied.applied, 'affinity');
    assert.deepEqual(applied.cpuIds, [0, 64, 127]);
    assert.ok(Object.prototype.hasOwnProperty.call(applied.configCpu, 'rx/0'));
    assert.equal(applied.argv.length, 0);
});

test('empty / overflow / duplicates / normalize fixtures', () => {
    assert.equal(parseCpuIdList('').ok, false);
    assert.equal(parseCpuIdList('0,0,0').ok, true);
    assert.deepEqual(parseCpuIdList('0,0,0').ids, [0]);

    const oob = validateAffinity(hw('arm-big-little.json'), '0,1,99,4', { allowNormalize: true });
    assert.equal(oob.ok, true);
    assert.equal(oob.normalized, true);
    assert.deepEqual(oob.ids, [0, 1, 4]);

    const reject = validateAffinity(hw('single-core.json'), '1,2', { allowNormalize: false });
    assert.equal(reject.ok, false);

    const overflow = parseCpuIdList('70000');
    assert.equal(overflow.ok, false);
});

test('local fixture files exist', () => {
    const files = new Set(readdirSync(fixturesDir));
    for (const name of ['empty-mask.json', 'offline-and-oob.json', 'duplicates.json', 'gt64-id-list.json']) {
        assert.ok(files.has(name), name);
        local(name);
    }
});

test('affinity apply failure falls back to OS auto with warning', () => {
    const snap = hw('smt.json');
    const r = resolveAffinityApply({
        snapshot: snap,
        manualCpuIds: [0, 2, 4],
        applyFailed: true
    });
    assert.equal(r.applied, 'os-auto');
    assert.ok(r.warnings.some((w) => /apply failed/i.test(w)));
    assert.equal(r.argv.length, 0);
});

test('macOS / web do not emit hard affinity argv', () => {
    assert.equal(affinityCapability('macos').canEmitXmrigAffinity, false);
    assert.equal(affinityCapability('web').mode, 'unsupported');
    const apple = hw('apple-silicon.json');
    const r = resolveAffinityApply({ snapshot: apple, manualCpuIds: [0, 1] });
    assert.equal(r.applied, 'os-auto');
    assert.ok(r.warnings.some((w) => /ignored|OS auto/i.test(w)));
});

test('hotplug/cpuset recompute keeps or falls back with diff', () => {
    const prev = hw('intel-hybrid.json');
    const next = structuredClone(prev);
    next.cpu.allowed.value = 8;
    // Shrink groups to first 8 P-cores only
    next.cpu.coreGroups.value = [
        { kind: 'performance', logicalIds: [0, 1, 2, 3, 4, 5, 6, 7], label: 'P' }
    ];
    const ok = recomputeAffinityProfile({
        previousSnapshot: prev,
        nextSnapshot: next,
        profile: { mode: 'affinity', cpuIds: [0, 1, 2, 12], candidateId: 'manual' }
    });
    assert.equal(ok.stillValid, true);
    assert.ok(!ok.profile.cpuIds.includes(12));
    assert.ok(ok.warnings.length >= 1);

    const bad = recomputeAffinityProfile({
        previousSnapshot: prev,
        nextSnapshot: hw('single-core.json'),
        profile: { mode: 'affinity', cpuIds: [4, 5, 6], candidateId: 'group-p' }
    });
    assert.equal(bad.stillValid, false);
    assert.equal(bad.profile.mode, 'os-auto');
    assert.equal(bad.profile.previousCandidateId, 'group-p');
});

test('mask hex encoding round-trips low ids', () => {
    const mask = idsToMaskHex([0, 2, 4]);
    assert.equal(mask.hex, '0x15');
    assert.equal(mask.preferIdList, false);
    const parsed = parseCpuIdList(mask.hex);
    assert.deepEqual(parsed.ids, [0, 2, 4]);
});

test('≤64 affinity emits --cpu-affinity argv', () => {
    const snap = hw('smt.json');
    const r = resolveAffinityApply({ snapshot: snap, manualCpuIds: '0,2,4' });
    assert.equal(r.applied, 'affinity');
    assert.ok(r.argv.some((a) => a.startsWith('--cpu-affinity=')));
    assert.equal(r.verifiedReadback, false);
});
