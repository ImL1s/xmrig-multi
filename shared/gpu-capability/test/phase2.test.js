/**
 * GPU phase-2 tests (#65).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveGpuEnablement,
    runBackendSelftest,
    releaseGpuContext,
    formatGpuEfficiency
} from '../js/phase2.js';

test('default preferences leave startable GPU disabled', () => {
    const r = resolveGpuEnablement({
        platform: 'desktop',
        packagedBackends: { opencl: false, cuda: true },
        cpuMiningAvailable: true,
        devices: [
            { id: 'gpu0', backends: ['cuda'], status: 'supported', selftestPassed: true, vramMb: 8192 }
        ]
    }, {});
    assert.equal(r.enabledDevices.length, 0);
    assert.equal(r.devices[0].userEnabled, false);
});

test('user can enable only startable devices; multi-GPU independent', () => {
    const r = resolveGpuEnablement({
        platform: 'desktop',
        packagedBackends: { opencl: true, cuda: true },
        cpuMiningAvailable: true,
        devices: [
            { id: 'gpu0', backends: ['cuda'], status: 'supported', selftestPassed: true, vramMb: 8192 },
            { id: 'gpu1', backends: ['opencl'], status: 'supported', selftestPassed: true, vramMb: 4096 }
        ]
    }, { gpu0: true });
    assert.equal(r.enabledDevices.length, 1);
    assert.equal(r.enabledDevices[0].id, 'gpu0');
    assert.equal(r.devices.find((d) => d.id === 'gpu1').enabled, false);
});

test('load-only plugin success is not enough', () => {
    const t = runBackendSelftest({ loadOnlySuccess: true, jobSubmitOk: false });
    assert.equal(t.passed, false);
    assert.match(t.reason, /not sufficient/i);
});

test('selftest + job submit passes', () => {
    assert.equal(runBackendSelftest({ selftestPassed: true, jobSubmitOk: true }).passed, true);
});

test('releaseGpuContext clears workers/memory', () => {
    const rel = releaseGpuContext({ sessionId: 's1', lastError: 'thermal' });
    assert.equal(rel.contextsOpen, 0);
    assert.equal(rel.workersJoined, true);
    assert.equal(rel.memoryReleased, true);
    assert.equal(rel.released, true);
});

test('no fabricated H/W without watts', () => {
    assert.equal(formatGpuEfficiency({ hashrate: 1000 }).unknown, true);
    assert.equal(formatGpuEfficiency({ hashrate: 1000, watts: 50 }).unknown, false);
});
