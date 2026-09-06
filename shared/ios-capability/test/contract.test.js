/**
 * iOS capability contract tests (#60).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { effectiveRandomxConfig, resolveIosCapability } from '../js/resolve.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fx = (name) => JSON.parse(readFileSync(join(root, 'fixtures', name), 'utf8'));

test('app-store companion never mines on device', () => {
    const cap = resolveIosCapability(fx('app-store-companion.json'));
    assert.equal(cap.canMineOnDevice, false);
    assert.equal(cap.randomx.mode, 'unavailable');
    assert.equal(effectiveRandomxConfig(cap).ok, false);
});

test('missing binary / failed selftest fail closed before allocation', () => {
    const cap = resolveIosCapability(fx('missing-binary.json'));
    assert.equal(cap.canMineOnDevice, false);
    assert.ok(cap.miningBlockedReason.includes('binary'));
});

test('sideload with verified JIT emits jit true; unverified jit key stays false', () => {
    const verified = resolveIosCapability(fx('sideload-jit-verified.json'));
    assert.equal(verified.canMineOnDevice, true);
    assert.equal(verified.randomx.jit, true);
    assert.equal(effectiveRandomxConfig(verified).config.jit, true);

    const unverified = resolveIosCapability(fx('sideload-jit-unverified.json'));
    assert.equal(unverified.canMineOnDevice, true);
    assert.equal(unverified.randomx.jit, false);
    assert.equal(effectiveRandomxConfig(unverified).config.jit, false);
    assert.ok(unverified.warnings.some((w) => /unverified/i.test(w)));
});

test('background never promised as permanent', () => {
    const cap = resolveIosCapability(fx('sideload-jit-verified.json'));
    assert.equal(cap.background.reliable, false);
});

test('unverified channel stays fail-closed', () => {
    const cap = resolveIosCapability({
        channel: 'unverified',
        binaryPresent: true,
        selftestPassed: true
    });
    assert.equal(cap.canMineOnDevice, false);
});
