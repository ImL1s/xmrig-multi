/**
 * GPU phase-2 optional enable / preference / release (#65).
 * Packaged builds still ship backends OFF; this gates explicit enable when a
 * verified plugin+selftest path exists.
 */

import { evaluateGpu } from '../../gpu-capability/js/evaluate.js';

/**
 * Per-device user preference. Default: all GPUs off.
 * @param {object[]} devices
 * @param {Record<string, boolean>} prefs deviceId → enabled
 */
export function resolveGpuEnablement(rawSnapshot = {}, prefs = {}) {
    const evaluated = evaluateGpu(rawSnapshot);
    const devices = evaluated.snapshot.devices.map((d) => {
        const want = prefs[d.id] === true;
        let enabled = false;
        let reason = d.reason;
        if (!d.startable) {
            enabled = false;
            reason = reason || 'Device not startable';
        } else if (!want) {
            enabled = false;
            reason = 'User preference: GPU left disabled (default)';
        } else {
            enabled = true;
            reason = 'User enabled + selftest passed';
        }
        return { ...d, userEnabled: want, enabled, reason };
    });

    return {
        ...evaluated,
        devices,
        enabledDevices: devices.filter((d) => d.enabled),
        autoEnableAll: false
    };
}

/**
 * Simulated backend selftest / known-answer gate.
 * Real CUDA/OpenCL selftest is platform-specific; CI uses fixtures only.
 */
export function runBackendSelftest(fixture = {}) {
    if (fixture.pluginMissing) {
        return { passed: false, reason: 'Plugin missing' };
    }
    if (fixture.pluginWrongHash) {
        return { passed: false, reason: 'Plugin hash mismatch' };
    }
    if (fixture.pluginWrongAbi) {
        return { passed: false, reason: 'Plugin ABI mismatch' };
    }
    if (fixture.knownAnswerFail) {
        return { passed: false, reason: 'Known-answer vector failed' };
    }
    if (fixture.loadOnlySuccess && !fixture.jobSubmitOk) {
        return { passed: false, reason: 'Plugin loaded but job/submit not verified — not sufficient' };
    }
    if (fixture.selftestPassed && fixture.jobSubmitOk) {
        return { passed: true, reason: 'Selftest + local job/submit ok' };
    }
    return { passed: false, reason: 'Selftest evidence incomplete' };
}

/**
 * Release GPU context on stop / failure / restart.
 */
export function releaseGpuContext(state = {}) {
    return {
        contextsOpen: 0,
        workersJoined: true,
        memoryReleased: true,
        lastError: state.lastError || null,
        sessionId: state.sessionId || null,
        released: true
    };
}

/**
 * Prefer measured energy; never invent H/W.
 */
export function formatGpuEfficiency(sample = {}) {
    if (sample.watts == null || !Number.isFinite(Number(sample.watts)) || sample.watts <= 0) {
        return { text: null, unknown: true, reason: 'No trusted power sensor — H/W not shown' };
    }
    if (sample.hashrate == null || !Number.isFinite(Number(sample.hashrate))) {
        return { text: null, unknown: true, reason: 'Hashrate unavailable' };
    }
    const hw = Number(sample.hashrate) / Number(sample.watts);
    return { text: hw, unit: 'H/W', unknown: false };
}
