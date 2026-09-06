/**
 * GPU capability fixture tests (#65 phase 1).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateGpu } from '../js/evaluate.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

function load(name) {
    return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));
}

test('all fixtures evaluate without startable devices when backends off or unsupported', () => {
    const files = readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));
    assert.ok(files.length >= 10);
    for (const f of files) {
        const r = evaluateGpu(load(f));
        assert.equal(r.cpuFallback.ok, true, f);
        // Current packaged defaults: no startable GPU
        if (!load(f).packagedBackends?.opencl && !load(f).packagedBackends?.cuda) {
            assert.equal(r.startableDevices.length, 0, f);
        }
        // Plugin failure fixtures force zero startable even if cuda packaged true
        if (f.startsWith('plugin-') || f === 'driver-missing.json' || f === 'vram-insufficient.json') {
            assert.equal(r.startableDevices.length, 0, f);
        }
        if (f.startsWith('unsupported-')) {
            assert.equal(r.startableDevices.length, 0, f);
            assert.ok(r.snapshot.devices.every((d) => d.status === 'unavailable'));
        }
    }
});

test('no-gpu keeps CPU fallback', () => {
    const r = evaluateGpu(load('no-gpu.json'));
    assert.equal(r.snapshot.devices.length, 0);
    assert.equal(r.cpuFallback.ok, true);
    assert.equal(r.startableDevices.length, 0);
});

test('multi-gpu devices stay independent and non-startable without packaged backends', () => {
    const r = evaluateGpu(load('multi-gpu.json'));
    assert.equal(r.snapshot.devices.length, 2);
    assert.ok(r.snapshot.devices.every((d) => d.startable === false));
});

test('iOS Metal is not relabeled as startable OpenCL/CUDA', () => {
    const r = evaluateGpu(load('unsupported-ios-metal.json'));
    assert.ok(r.snapshot.devices.every((d) => d.status === 'unavailable' && !d.startable));
    assert.ok(r.snapshot.notes.some((n) => /ios/i.test(n)));
});

test('hardware present + backends off ≠ startable', () => {
    const r = evaluateGpu({
        platform: 'desktop',
        packagedBackends: { opencl: false, cuda: false },
        cpuMiningAvailable: true,
        devices: [
            { id: 'gpu0', backends: ['cuda'], status: 'supported', selftestPassed: true, vramMb: 8192 }
        ]
    });
    assert.equal(r.startableDevices.length, 0);
    assert.match(r.snapshot.devices[0].reason, /disabled|backends|packaged/i);
});

test('phase-2 style startable only with packaged backend + selftest', () => {
    const r = evaluateGpu({
        platform: 'desktop',
        packagedBackends: { opencl: false, cuda: true },
        cpuMiningAvailable: true,
        devices: [
            { id: 'gpu0', backends: ['cuda'], status: 'supported', selftestPassed: true, vramMb: 8192 }
        ]
    });
    assert.equal(r.startableDevices.length, 1);
    assert.equal(r.startableDevices[0].id, 'gpu0');
});
