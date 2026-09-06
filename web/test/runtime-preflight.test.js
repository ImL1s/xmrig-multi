import test from 'node:test';
import assert from 'node:assert/strict';
import {
    PREFLIGHT_CODES,
    runMiningPreflight,
    validateSeedHash
} from '../js/runtime-preflight.js';

test('#51 preflight fails without crossOriginIsolated', () => {
    const r = runMiningPreflight({
        isSecureContext: true,
        crossOriginIsolated: false,
        SharedArrayBuffer: class {},
        WebAssembly: {},
        Worker: function Worker() {},
        tryAllocateSAB: false
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, PREFLIGHT_CODES.NOT_CROSS_ORIGIN_ISOLATED);
    assert.ok(r.actionHints.some((h) => /COOP|COEP|Opener|Embedder/i.test(h)));
});

test('#51 preflight fails without SAB', () => {
    const r = runMiningPreflight({
        isSecureContext: true,
        crossOriginIsolated: true,
        SharedArrayBuffer: undefined,
        WebAssembly: {},
        Worker: function Worker() {},
        tryAllocateSAB: false
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, PREFLIGHT_CODES.NO_SHARED_ARRAY_BUFFER);
});

test('#51 preflight fails on insecure context', () => {
    const r = runMiningPreflight({
        isSecureContext: false,
        crossOriginIsolated: true,
        SharedArrayBuffer: class {},
        WebAssembly: {},
        Worker: function Worker() {},
        tryAllocateSAB: false
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, PREFLIGHT_CODES.INSECURE_CONTEXT);
});

test('#51 preflight passes with fixtures', () => {
    class FakeSAB {
        constructor() {}
    }
    const r = runMiningPreflight({
        isSecureContext: true,
        crossOriginIsolated: true,
        SharedArrayBuffer: FakeSAB,
        WebAssembly: {},
        Worker: function Worker() {},
        tryAllocateSAB: true
    });
    assert.equal(r.ok, true);
    assert.equal(r.code, PREFLIGHT_CODES.OK);
});

test('#51 refuses placeholder default seed', () => {
    assert.equal(validateSeedHash('default').ok, false);
    assert.equal(validateSeedHash('default').code, 'placeholder_seed');
});

test('#51 accepts 32-byte hex seed', () => {
    const seed = 'a'.repeat(64);
    const v = validateSeedHash(seed);
    assert.equal(v.ok, true);
    assert.equal(v.seed, seed);
});

test('#51 rejects odd-length / short seeds', () => {
    assert.equal(validateSeedHash('abc').ok, false);
    assert.equal(validateSeedHash('aa'.repeat(16)).ok, false); // 16 bytes
});
