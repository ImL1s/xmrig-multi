import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ownsGeneration,
    applyIfOwner,
    beginSessionOwner,
    mayClearSession
} from '../js/ownership.js';
import {
    NONCE_MOD,
    toUint32,
    nextNonce,
    addNonce,
    allocateNonceSpace,
    bumpJobLoopGeneration
} from '../js/nonce.js';
import { createFakeMiner } from '../js/fake-miner.js';

test('old generation cannot update or clear a newer session', () => {
    let state = beginSessionOwner({ generation: 0, value: { hashrate: 0 } }, { hashrate: 0 });
    assert.equal(state.generation, 1);

    const ok = applyIfOwner(state, 1, (v) => ({ ...v, hashrate: 100 }));
    assert.equal(ok.applied, true);
    assert.equal(ok.value.hashrate, 100);
    state = ok;

    // New session starts
    state = beginSessionOwner(state, { hashrate: 0 });
    assert.equal(state.generation, 2);

    const stale = applyIfOwner(state, 1, (v) => ({ ...v, hashrate: 999 }));
    assert.equal(stale.applied, false);
    assert.equal(stale.value.hashrate, 0);

    assert.equal(mayClearSession(1, 2, false), false);
    assert.equal(mayClearSession(2, 2, true), false);
    assert.equal(mayClearSession(2, 2, false), true);
});

test('ownsGeneration requires positive matching ids', () => {
    assert.equal(ownsGeneration(0, 0), false);
    assert.equal(ownsGeneration(3, 3), true);
    assert.equal(ownsGeneration(2, 3), false);
});

test('nonce rollover uses full 32-bit range', () => {
    assert.equal(NONCE_MOD, 4294967296);
    assert.equal(toUint32(-1), 0xffffffff);
    assert.equal(nextNonce(0xfffffffe), 0xffffffff);
    assert.equal(nextNonce(0xffffffff), 0);
    assert.equal(addNonce(0xfffffffc, 5), 1);
    // Classic off-by-one bug: % 0xffffffff never yields 0xffffffff
    assert.notEqual(0xffffffff % 0xffffffff, 0xffffffff);
});

test('nonce space partition is deterministic and disjoint for powers of two', () => {
    const a = allocateNonceSpace(0, 4, 7);
    const b = allocateNonceSpace(1, 4, 7);
    const c = allocateNonceSpace(0, 4, 7);
    assert.deepEqual(a, c);
    assert.equal(a.stride, 4);
    assert.notEqual(a.start, b.start);

    const seen = new Set();
    for (let w = 0; w < 4; w++) {
        const { start, stride } = allocateNonceSpace(w, 4, 7);
        for (let i = 0; i < 64; i++) {
            const n = addNonce(start, i * stride);
            assert.equal(seen.has(n), false, `collision at ${n}`);
            seen.add(n);
        }
    }
});

test('job loop generation bumps on job/resume/seed change', () => {
    let g = 0;
    g = bumpJobLoopGeneration(g);
    assert.equal(g, 1);
    const first = g;
    g = bumpJobLoopGeneration(g); // resume / duplicate job
    assert.equal(g, 2);
    assert.notEqual(first, g);
});

test('100 start/stop cycles leave no pollers', async () => {
    const miner = createFakeMiner({ pollMs: 5, reapMs: 5 });
    for (let i = 0; i < 100; i++) {
        await miner.start({ port: 37420 + (i % 3) });
        await miner.stop();
    }
    const s = miner.getState();
    assert.equal(s.running, false);
    assert.equal(s.activePollers, 0);
    assert.equal(s.hasToken, false);
    miner.dispose();
});

test('stale poller cannot overwrite newer session hashrate', async () => {
    const miner = createFakeMiner({ pollMs: 5, reapMs: 5 });
    const first = await miner.start();
    const staleGen = first.generation;
    await miner.stop();
    await miner.start();
    assert.equal(miner.injectStaleStats(staleGen, { hashrate: 777 }), false);
    assert.notEqual(miner.getState().stats.hashrate, 777);
    await miner.stop();
    miner.dispose();
});
