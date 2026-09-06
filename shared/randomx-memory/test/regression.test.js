/**
 * #129 regression: hard-limit OOM bypass + RandomWOW dataset constants.
 * Run: node --test shared/randomx-memory/test/*.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ALGORITHMS,
    ENGINE_DATASET_BASE_PLUS_EXTRA_BYTES,
    ENGINE_DATASET_MIB,
    ENGINE_VERSION,
    MIB
} from '../js/constants.js';
import { estimateMemory } from '../js/estimate.js';
import { selectRandomXMode } from '../js/select.js';
import {
    OomRetryBudget,
    attemptRandomXLaunch,
    createFakeAllocator
} from '../js/launch.js';

test('REG06: 64 MiB hard limit blocks normal and OOM light paths', () => {
    const input = {
        algorithm: 'rx/0',
        requestedMode: 'auto',
        threads: 1,
        availableBytes: 64 * MIB,
        processLimitBytes: 64 * MIB
    };
    const normal = selectRandomXMode(input);
    assert.equal(normal.blocked, true);
    assert.equal(normal.ok, false);
    assert.equal(normal.estimate.fitsHardLimit, false);

    const oom = selectRandomXMode({ ...input, allocationFailed: true });
    assert.equal(oom.blocked, true, 'OOM light retry must not bypass hard limit');
    assert.equal(oom.ok, false);
    assert.equal(oom.appliedMode, null);
    assert.equal(oom.estimate.fitsHardLimit, false);
    assert.ok(oom.estimate.miningBytes >= 256 * MIB);
});

test('REG07: soft override cannot cross hard 64 MiB limit on OOM retry', () => {
    const oom = selectRandomXMode({
        algorithm: 'rx/0',
        requestedMode: 'auto',
        threads: 1,
        availableBytes: 64 * MIB,
        processLimitBytes: 64 * MIB,
        allocationFailed: true,
        confirmSoftOverride: true
    });
    assert.equal(oom.blocked, true);
    assert.equal(oom.ok, false);
});

test('REG08: WOW fast with 1 GiB hard limit must block (dataset ~2080 MiB)', () => {
    const r = selectRandomXMode({
        algorithm: 'rx/wow',
        requestedMode: 'fast',
        locked: true,
        threads: 1,
        availableBytes: 4 * 1024 * MIB,
        processLimitBytes: 1024 * MIB,
        appReserveMiB: 128
    });
    assert.equal(r.ok, false);
    assert.equal(r.blocked, true);
    const dataset = r.estimate.components.find((c) => c.name === 'dataset');
    assert.ok(dataset);
    assert.ok(dataset.bytes >= ENGINE_DATASET_BASE_PLUS_EXTRA_BYTES);
    assert.equal(dataset.bytes / MIB, ENGINE_DATASET_MIB);
});

test('engine dataset constant covers XMRig 6.21.0 base+extra bytes', () => {
    assert.equal(ENGINE_VERSION, '6.21.0');
    assert.equal(ENGINE_DATASET_BASE_PLUS_EXTRA_BYTES, 2147483648 + 33554368);
    assert.ok(ENGINE_DATASET_MIB * MIB >= ENGINE_DATASET_BASE_PLUS_EXTRA_BYTES);
    assert.equal(ALGORITHMS['rx/wow'].datasetMiB, ENGINE_DATASET_MIB);
    assert.equal(ALGORITHMS['rx/0'].datasetMiB, ENGINE_DATASET_MIB);
    assert.equal(ALGORITHMS['rx/wow'].scratchpadMiB, 1);
    assert.equal(ALGORITHMS['rx/0'].scratchpadMiB, 2);
});

test('hard limit exact fit vs one-byte short', () => {
    const light = estimateMemory({ algorithm: 'rx/0', mode: 'light', threads: 1 });
    const exact = light.miningBytes;
    // Soft budget uses availableBytes; keep it ample so only hard limit is under test.
    const ok = selectRandomXMode({
        algorithm: 'rx/0',
        requestedMode: 'light',
        threads: 1,
        availableBytes: 8 * 1024 * MIB,
        processLimitBytes: exact
    });
    assert.equal(ok.blocked, false);
    assert.equal(ok.appliedMode, 'light');
    assert.equal(ok.estimate.fitsHardLimit, true);

    const short = selectRandomXMode({
        algorithm: 'rx/0',
        requestedMode: 'light',
        threads: 1,
        availableBytes: 8 * 1024 * MIB,
        processLimitBytes: exact - 1
    });
    assert.equal(short.blocked, true);
    assert.equal(short.ok, false);
    assert.equal(short.estimate.fitsHardLimit, false);
});

test('locked fast OOM path refuses silent downgrade', () => {
    const locked = selectRandomXMode({
        algorithm: 'rx/0',
        requestedMode: 'fast',
        locked: true,
        threads: 1,
        availableBytes: 8 * 1024 * MIB,
        allocationFailed: true
    });
    assert.equal(locked.ok, false);
    assert.equal(locked.blocked, true);
    assert.equal(locked.appliedMode, null);
    assert.ok(locked.reasons.some((r) => /locked/i.test(r)));
});

test('sufficient RAM OOM light retry permitted once via budget', () => {
    const budget = new OomRetryBudget(1);
    const allocator = createFakeAllocator();
    const first = attemptRandomXLaunch(
        {
            algorithm: 'rx/0',
            requestedMode: 'auto',
            threads: 1,
            availableBytes: 8 * 1024 * MIB,
            allocationFailed: true
        },
        { allocator, retryBudget: budget, sessionGeneration: 'gen-1' }
    );
    assert.equal(first.launched, true);
    assert.equal(first.appliedMode, 'light');
    assert.equal(first.allocations.cache, 1);
    assert.equal(first.allocations.dataset, 0);

    const second = attemptRandomXLaunch(
        {
            algorithm: 'rx/0',
            requestedMode: 'auto',
            threads: 1,
            availableBytes: 8 * 1024 * MIB,
            allocationFailed: true
        },
        { allocator, retryBudget: budget, sessionGeneration: 'gen-1' }
    );
    assert.equal(second.launched, false);
    assert.equal(second.blocked, true);
    assert.equal(second.allocations.cache, 1, 'exhausted budget must not allocate again');
});

test('fake allocator spy: blocked never creates cache/dataset and release clears live', () => {
    const allocator = createFakeAllocator();
    const blocked = attemptRandomXLaunch(
        {
            algorithm: 'rx/0',
            requestedMode: 'auto',
            threads: 1,
            availableBytes: 64 * MIB,
            processLimitBytes: 64 * MIB,
            allocationFailed: true
        },
        { allocator }
    );
    assert.equal(blocked.launched, false);
    assert.deepEqual(allocator.snapshot(), { cache: 0, dataset: 0, live: 0 });

    const okAlloc = createFakeAllocator();
    const ok = attemptRandomXLaunch(
        {
            algorithm: 'rx/0',
            requestedMode: 'light',
            threads: 1,
            availableBytes: 8 * 1024 * MIB
        },
        { allocator: okAlloc }
    );
    assert.equal(ok.launched, true);
    assert.equal(okAlloc.snapshot().cache, 1);
    okAlloc.releaseAll();
    assert.equal(okAlloc.snapshot().live, 0);
    assert.equal(okAlloc.released, true);
});

test('unknown available with known hard limit still enforces hard gate', () => {
    const sel = selectRandomXMode({
        algorithm: 'rx/0',
        requestedMode: 'light',
        threads: 2,
        availableBytes: null,
        totalBytes: null,
        processLimitBytes: 100 * MIB
    });
    assert.equal(sel.blocked, true);
    assert.equal(sel.estimate.fitsHardLimit, false);
});

test('WOW light with ample RAM succeeds; fast needs dataset headroom', () => {
    const light = selectRandomXMode({
        algorithm: 'rx/wow',
        requestedMode: 'light',
        threads: 2,
        availableBytes: 4 * 1024 * MIB
    });
    assert.equal(light.appliedMode, 'light');
    assert.equal(light.blocked, false);

    const fastOk = selectRandomXMode({
        algorithm: 'rx/wow',
        requestedMode: 'fast',
        threads: 1,
        availableBytes: 16 * 1024 * MIB,
        processLimitBytes: 16 * 1024 * MIB
    });
    assert.equal(fastOk.appliedMode, 'fast');
    assert.ok(fastOk.estimate.miningBytes >= ENGINE_DATASET_MIB * MIB);
});
