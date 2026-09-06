/**
 * Artifact smoke tests (#64).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { smokeWebDist, smokeManifestConsistency } from '../js/smoke.js';
import { loadManifest } from '../../release-capability/js/load.js';
import { readFileSync } from 'node:fs';

test('missing dist fails closed', () => {
    const r = smokeWebDist(join(tmpdir(), 'no-such-xmrig-dist-' + Date.now()));
    assert.equal(r.ok, false);
});

test('minimal dist passes smoke markers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xmrig-smoke-'));
    try {
        writeFileSync(join(dir, 'index.html'), '<button id="start">開始挖礦</button>');
        writeFileSync(join(dir, 'app.js'), 'console.log(1)');
        const r = smokeWebDist(dir);
        assert.equal(r.ok, true, JSON.stringify(r.checks));
        assert.equal(r.layer, 'L1-static-sanity');
        assert.ok(r.checks.every((c) => String(c.id).startsWith('static-')));
        assert.ok(r.residual.some((x) => /UI\/native/i.test(x)));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('manifest evidence commands must not stay pending', () => {
    const m = loadManifest();
    // companion-sync may still be pending on older main — this branch should fix it.
    const harness = readFileSync(
        new URL('../../../docs/harness.md', import.meta.url),
        'utf8'
    );
    const r = smokeManifestConsistency(m, harness);
    const pending = r.checks.filter((c) => !c.ok);
    assert.equal(pending.length, 0, JSON.stringify(pending));
});
