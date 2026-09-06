/**
 * Fee manifest contract tests (#63).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFeeManifest, summarizeFees, validateManifest } from '../js/load.js';
import { FEE_DEFAULTS, isDevFeeWindow, describeBasis } from '../js/time-window.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('manifest loads and matches DevFeePolicy numbers', () => {
    const m = loadFeeManifest();
    assert.equal(m.developerPercent, 1);
    assert.equal(m.cycleSeconds, 6000);
    assert.equal(m.feeDurationSeconds, 60);
    assert.equal(m.developerWallet, FEE_DEFAULTS.wallet);
    assert.equal(m.basis, 'mining-time-window');
});

test('iOS tracked artifact is flagged mismatch', () => {
    const m = loadFeeManifest();
    assert.equal(m.platforms.ios.mismatch, true);
    const sum = summarizeFees(m, 'ios');
    assert.equal(sum.mismatch, true);
    assert.ok(sum.lines.some((l) => l.includes('mismatch') || l.includes('⚠')));
});

test('pool fee unknown must not render as 0%', () => {
    const m = loadFeeManifest();
    const sum = summarizeFees(m, 'android');
    const pool = sum.layers.find((l) => l.kind === 'pool');
    assert.ok(pool);
    assert.equal(pool.rateLabel, 'unknown (not 0%)');
    assert.ok(!sum.lines.some((l) => /pool: 0%/i.test(l)));
});

test('known pool fee is shown when provided', () => {
    const m = loadFeeManifest();
    const sum = summarizeFees(m, 'desktop', { poolFeeKnown: true, poolFeePercent: 0.6 });
    assert.ok(sum.layers.find((l) => l.kind === 'pool').rateLabel.includes('0.6%'));
});

test('web stacking note present — proxy vs native not conflated', () => {
    const m = loadFeeManifest();
    const sum = summarizeFees(m, 'web');
    assert.ok(sum.lines.some((l) => /proxy/i.test(l) && /native/i.test(l)));
});

test('time window math: 99 min user / 1 min fee', () => {
    assert.equal(isDevFeeWindow(0), false);
    assert.equal(isDevFeeWindow(5939), false);
    assert.equal(isDevFeeWindow(5940), true);
    assert.equal(isDevFeeWindow(5999), true);
    assert.equal(isDevFeeWindow(6000), false);
});

test('basis copy distinguishes time share from pool fee', () => {
    assert.match(describeBasis('mining-time-window'), /not a pool fee/i);
    assert.match(describeBasis('pool-policy'), /not display as 0%/i);
});

test('reject pool layer hardcoded to 0%', () => {
    const bad = JSON.parse(readFileSync(join(root, 'manifest.v1.json'), 'utf8'));
    bad.platforms.android.layers.find((l) => l.kind === 'pool').ratePercent = 0;
    assert.throws(() => validateManifest(bad), /must not be hardcoded 0/);
});
