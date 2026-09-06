/**
 * Release capability contract tests (#64).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest, assertConsistent, checklist } from '../js/load.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('manifest loads and is consistent', () => {
    const m = loadManifest();
    assert.equal(m.schemaVersion, 1);
    assert.ok(m.platforms.android);
    assert.ok(m.platforms.desktop);
    assert.ok(m.platforms.web);
});

test('OpenCL/CUDA never supported or startable on packaged platforms', () => {
    const m = loadManifest();
    for (const [name, p] of Object.entries(m.platforms)) {
        for (const b of ['opencl', 'cuda']) {
            if (!p[b]) continue;
            assert.equal(p[b].status, 'unavailable', `${name}.${b}`);
            assert.notEqual(p[b].startable, true);
        }
    }
    const c = checklist(m);
    assert.equal(c.gpuStartableAnywhere, false);
});

test('supported entries require catalog evidenceId', () => {
    const bad = JSON.parse(readFileSync(join(root, 'manifest.v1.json'), 'utf8'));
    bad.platforms.web.coins.monero = { status: 'supported' };
    assert.throws(() => assertConsistent(bad), /evidenceId/);
});

test('claiming GPU supported fails the gate', () => {
    const bad = JSON.parse(readFileSync(join(root, 'manifest.v1.json'), 'utf8'));
    bad.platforms.desktop.opencl = { status: 'supported', evidenceId: 'gpu-capability' };
    assert.throws(() => assertConsistent(bad), /WITH_OPENCL/);
});

test('checklist exposes unverified platforms and limits', () => {
    const c = checklist();
    assert.ok(c.unverified.length > 0);
    assert.ok(c.knownLimits.android.length > 0);
});
