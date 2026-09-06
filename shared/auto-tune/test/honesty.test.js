/**
 * Auto-tune honesty regressions (#128).
 * Must fail on b312f8b-era tuner; pass after adapter/score/cancel fixes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidates } from '../js/candidates.js';
import { fakeBenchmark } from '../js/benchmark.js';
import { runAutoTune } from '../js/tuner.js';

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

test('no default synthetic adapter — uncalibrated without benchmark', async () => {
    const result = await runAutoTune({
        snapshot: snap()
    });
    assert.equal(result.phase, 'idle');
    assert.equal(result.ok, false);
    assert.equal(result.claims.measuredHashrate, false);
    assert.equal(result.claims.estimatedOnly, true);
    assert.ok(result.warnings.some((w) => /adapter/i.test(w)));
});

test('explicit fakeBenchmark never claims measured hashrate', async () => {
    const result = await runAutoTune({
        snapshot: snap(),
        goal: 'max_sustained',
        benchmark: fakeBenchmark,
        benchmarkCtx: { map: { 't8-fast': { hashrate: 800 } } }
    });
    assert.equal(result.claims.measuredHashrate, false);
    assert.equal(result.claims.estimatedOnly, true);
    assert.equal(result.claims.adapterKind, 'synthetic');
});

test('single-core quiet and power keep at least one candidate', () => {
    const one = {
        ...snap(),
        cpu: {
            logical: { value: 1, confidence: 'high' },
            physical: { value: 1, confidence: 'high' },
            allowed: { value: 1, confidence: 'high' },
            smt: { value: false, confidence: 'high' },
            heterogeneous: { value: false, confidence: 'high' }
        }
    };
    const quiet = buildCandidates({ snapshot: one, goal: 'quiet' });
    const power = buildCandidates({ snapshot: one, goal: 'power' });
    assert.ok(quiet.candidates.length >= 1);
    assert.ok(power.candidates.length >= 1);
    assert.ok(quiet.candidates.every((c) => c.threads === 1));
    assert.ok(power.candidates.every((c) => c.threads === 1));
});

test('power goal scores H/J not raw hashrate vs baseline', async () => {
    const result = await runAutoTune({
        snapshot: snap({
            sensors: {
                thermalReadable: { value: false, confidence: 'low' },
                powerReadable: { value: true, confidence: 'high' }
            }
        }),
        goal: 'power',
        baseline: { threads: 8, randomxMode: 'light' },
        benchmark: fakeBenchmark,
        benchmarkCtx: {
            map: {
                't1-light': { hashrate: 100, watts: 1 },
                't8-light': { hashrate: 200, watts: 100 }
            }
        },
        minImprovementPct: 3
    });
    assert.equal(result.ok, true);
    assert.equal(result.recommendation.threads, 1);
    assert.ok(result.recommendation.reason.includes('best for goal=power') || result.recommendation.threads === 1);
    // Synthetic adapter: even with powerReadable, do not claim measured H/J.
    assert.equal(result.claims.measuredHashesPerWatt, false);
    assert.equal(result.claims.estimatedOnly, true);
});

test('powerReadable without watts never claims measured H/J on live adapter', async () => {
    const live = async (c, ctx) => fakeBenchmark(c, { ...ctx, map: { [c.id]: { hashrate: 100 } } });
    const result = await runAutoTune({
        snapshot: snap({
            sensors: {
                thermalReadable: { value: false, confidence: 'low' },
                powerReadable: { value: true, confidence: 'high' }
            }
        }),
        goal: 'power',
        benchmark: live,
        benchmarkKind: 'live',
        lockedFields: ['cpu.threads', 'randomx.mode'],
        lockedThreads: 1,
        lockedRandomxMode: 'light'
    });
    assert.equal(result.claims.measuredHashrate, true);
    assert.equal(result.claims.measuredHashesPerWatt, false);
});

test('abort during sole candidate returns cancelled not completed ok', async () => {
    const ac = { aborted: false };
    const signal = {
        get aborted() {
            return ac.aborted;
        }
    };
    const bench = async (c, ctx) => {
        ac.aborted = true;
        return fakeBenchmark(c, { ...ctx, abortSignal: signal });
    };
    const result = await runAutoTune({
        snapshot: snap(),
        goal: 'balanced',
        lockedFields: ['cpu.threads', 'randomx.mode'],
        lockedThreads: 1,
        lockedRandomxMode: 'light',
        signal,
        benchmark: bench
    });
    assert.equal(result.phase, 'cancelled');
    assert.equal(result.ok, false);
    assert.equal(result.accepted, false);
});
