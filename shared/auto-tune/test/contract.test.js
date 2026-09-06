/**
 * Auto-tune contract tests (#34).
 * Run: node --test shared/auto-tune/test/*.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCandidates } from '../js/candidates.js';
import { fakeBenchmark } from '../js/benchmark.js';
import { isFingerprintStale, tuneFingerprint } from '../js/fingerprint.js';
import { acceptTuneResult, rollbackSettings, runAutoTune } from '../js/tuner.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (name) => JSON.parse(readFileSync(join(root, 'fixtures', name), 'utf8'));

function snap(overrides = {}) {
    return {
        cpu: {
            logical: { value: 8, confidence: 'high' },
            physical: { value: 4, confidence: 'medium' },
            allowed: { value: 8, confidence: 'high' },
            smt: { value: true, confidence: 'medium' },
            heterogeneous: { value: false, confidence: 'medium' }
        },
        memory: {
            totalBytes: { value: 16 * 1024 * 1024 * 1024, confidence: 'high' },
            availableBytes: { value: 12 * 1024 * 1024 * 1024, confidence: 'high' },
            processLimitBytes: { value: null, confidence: 'unknown' }
        },
        sensors: {
            thermalReadable: { value: false, confidence: 'low' },
            powerReadable: { value: false, confidence: 'low' }
        },
        ...overrides
    };
}

test('fingerprint changes when topology or engine changes', () => {
    const a = tuneFingerprint({ snapshot: snap(), engineBuild: 'xmrig-6.21', algorithm: 'rx/0' });
    const b = tuneFingerprint({ snapshot: snap(), engineBuild: 'xmrig-6.22', algorithm: 'rx/0' });
    assert.notEqual(a.hash, b.hash);
    assert.equal(isFingerprintStale(a.hash, b), true);
    assert.equal(isFingerprintStale(a.hash, a), false);
});

test('locked threads are excluded from search space growth', () => {
    const built = buildCandidates({
        snapshot: snap(),
        lockedFields: ['cpu.threads'],
        lockedThreads: 3,
        goal: 'balanced'
    });
    assert.ok(built.candidates.every((c) => c.threads === 3));
});

test('deterministic fake benchmark converges to max_sustained winner', async () => {
    const map = {
        't1-light': { hashrate: 100 },
        't4-light': { hashrate: 380 },
        't7-fast': { hashrate: 900 },
        't8-fast': { hashrate: 950 }
    };
    const result = await runAutoTune({
        snapshot: snap(),
        goal: 'max_sustained',
        baseline: { threads: 4, randomxMode: 'light' },
        benchmark: fakeBenchmark,
        benchmarkCtx: { map, noise: 0 },
        minImprovementPct: 3
    });
    assert.equal(result.phase, 'completed');
    assert.equal(result.ok, true);
    assert.equal(result.accepted, false);
    assert.ok(result.recommendation.threads >= 7);
    assert.equal(result.claims.measuredHashesPerWatt, false);
});

test('noisy tiny win keeps baseline', async () => {
    const f = fixture('noisy-winner.json');
    const result = await runAutoTune({
        snapshot: snap(),
        goal: 'balanced',
        baseline: f.baseline,
        benchmark: fakeBenchmark,
        benchmarkCtx: { map: f.map },
        minImprovementPct: f.minImprovementPct
    });
    assert.equal(result.recommendation.threads, f.baseline.threads);
    assert.ok(result.warnings.some((w) => /noise/i.test(w)));
});

test('cancel leaves no recommendation accepted and supports rollback', async () => {
    const ac = { aborted: false };
    const signal = {
        get aborted() {
            return ac.aborted;
        }
    };
    let calls = 0;
    const bench = async (c, ctx) => {
        calls += 1;
        if (calls === 1) ac.aborted = true;
        return fakeBenchmark(c, ctx);
    };
    const baseline = { threads: 2, randomxMode: 'light' };
    const result = await runAutoTune({
        snapshot: snap(),
        goal: 'balanced',
        baseline,
        signal,
        benchmark: bench
    });
    assert.ok(result.phase === 'cancelled' || result.phase === 'aborted');
    assert.equal(result.accepted, false);
    assert.deepEqual(rollbackSettings(result), baseline);
});

test('failed candidates yield conservative suggestion', async () => {
    const result = await runAutoTune({
        snapshot: snap(),
        goal: 'balanced',
        benchmark: fakeBenchmark,
        benchmarkCtx: { failIds: ['ALL'], map: {} },
        // force fail by wrapping
        shouldAbort: () => false
    });
    // Override: mark all as fail via custom bench
    const failed = await runAutoTune({
        snapshot: snap(),
        goal: 'balanced',
        benchmark: async (c) => fakeBenchmark(c, { failIds: [c.id] })
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.recommendation.randomxMode, 'light');
    assert.ok(failed.warnings.some((w) => /fail/i.test(w) || /conservative/i.test(w)));
});

test('accept refuses stale fingerprint; accept works when current', async () => {
    const result = await runAutoTune({
        snapshot: snap(),
        goal: 'max_sustained',
        baseline: { threads: 1, randomxMode: 'light' },
        benchmark: fakeBenchmark,
        benchmarkCtx: {
            map: {
                't1-light': { hashrate: 50 },
                't8-fast': { hashrate: 800 }
            }
        }
    });
    const stale = acceptTuneResult(result, tuneFingerprint({
        snapshot: snap(),
        engineBuild: 'other'
    }));
    // same engine default unknown — may or may not stale; force different hash
    const forcedStale = acceptTuneResult(
        { ...result, fingerprint: { hash: 'deadbeef' } },
        tuneFingerprint({ snapshot: snap() })
    );
    assert.equal(forcedStale.ok, false);

    const ok = acceptTuneResult(result, result.fingerprint);
    assert.equal(ok.ok, true);
    assert.ok(ok.settings.threads >= 1);
});

test('quiet goal never claims measured quiet without noise sensor', async () => {
    const result = await runAutoTune({
        snapshot: snap(),
        goal: 'quiet',
        benchmark: fakeBenchmark,
        benchmarkCtx: {
            map: {
                't1-light': { hashrate: 100, loadProxy: 1 },
                't4-light': { hashrate: 350, loadProxy: 4 }
            }
        }
    });
    assert.equal(result.claims.measuredQuiet, false);
    assert.equal(result.claims.quietUsesLoadProxy, true);
});

test('uncalibrated without snapshot returns conservative skip path', async () => {
    const result = await runAutoTune({});
    assert.equal(result.phase, 'idle');
    assert.equal(result.claims.estimatedOnly, true);
    assert.ok(result.warnings.length > 0);
});
