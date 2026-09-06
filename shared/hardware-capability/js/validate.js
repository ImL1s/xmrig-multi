/**
 * HardwareSnapshot field helpers + validation (#33).
 * Unknown numeric/sensor fields must stay null — never fake 0.
 */

export const CONFIDENCE = new Set(['high', 'medium', 'low', 'unknown']);
export const EVIDENCE = new Set(['fixture', 'live']);
export const INVALIDATION = new Set([
    'cpuset-change',
    'hotplug',
    'power-source-change',
    'thermal-throttle',
    'memory-pressure'
]);

/**
 * @param {unknown} value
 * @param {string} source
 * @param {'high'|'medium'|'low'|'unknown'} confidence
 * @param {string|null} [unknownReason]
 * @param {string} [timestamp]
 */
export function field(value, source, confidence, unknownReason = null, timestamp = new Date().toISOString()) {
    const out = { value, source, timestamp, confidence };
    if (value == null || confidence === 'unknown') {
        out.unknownReason = unknownReason || (value == null ? 'not-probed' : null);
    } else if (unknownReason) {
        out.unknownReason = unknownReason;
    } else {
        out.unknownReason = null;
    }
    return out;
}

export function unknownField(reason, source = 'none') {
    return field(null, source, 'unknown', reason);
}

/**
 * @param {unknown} snap
 * @returns {{ ok: true, snapshot: object } | { ok: false, errors: string[] }}
 */
export function validateHardwareSnapshot(snap) {
    const errors = [];
    if (!snap || typeof snap !== 'object' || Array.isArray(snap)) {
        return { ok: false, errors: ['snapshot must be an object'] };
    }
    if (snap.schemaVersion !== 1) {
        errors.push('schemaVersion must be 1');
    }
    if (typeof snap.capturedAt !== 'string' || !snap.capturedAt) {
        errors.push('capturedAt required');
    }
    if (!EVIDENCE.has(snap.evidenceKind)) {
        errors.push('evidenceKind must be fixture|live');
    }
    if (!snap.platform || typeof snap.platform !== 'object') {
        errors.push('platform required');
    } else {
        if (typeof snap.platform.os !== 'string' || !snap.platform.os) errors.push('platform.os required');
        if (typeof snap.platform.arch !== 'string' || !snap.platform.arch) errors.push('platform.arch required');
        checkField(snap.platform.osVersion, 'platform.osVersion', errors, 'string');
        checkField(snap.platform.abi, 'platform.abi', errors, 'string');
        checkField(snap.platform.containerOrVm, 'platform.containerOrVm', errors, 'boolean');
    }

    if (!snap.cpu || typeof snap.cpu !== 'object') {
        errors.push('cpu required');
    } else {
        checkField(snap.cpu.name, 'cpu.name', errors, 'string');
        checkField(snap.cpu.logical, 'cpu.logical', errors, 'number', true);
        checkField(snap.cpu.physical, 'cpu.physical', errors, 'number', true);
        checkField(snap.cpu.allowed, 'cpu.allowed', errors, 'number', true);
        checkField(snap.cpu.smt, 'cpu.smt', errors, 'boolean');
        checkField(snap.cpu.heterogeneous, 'cpu.heterogeneous', errors, 'boolean');
        checkField(snap.cpu.numaNodes, 'cpu.numaNodes', errors, 'number');
        if (snap.cpu.cache) {
            checkField(snap.cpu.cache.l2Bytes, 'cpu.cache.l2Bytes', errors, 'number');
            checkField(snap.cpu.cache.l3Bytes, 'cpu.cache.l3Bytes', errors, 'number');
        }
        if (snap.cpu.coreGroups) {
            const g = snap.cpu.coreGroups;
            if (!CONFIDENCE.has(g.confidence)) errors.push('cpu.coreGroups.confidence invalid');
            if (g.value != null && !Array.isArray(g.value)) errors.push('cpu.coreGroups.value must be array|null');
        }
        // Fake-zero guard: known-unknown memory/cache must not be 0 with high confidence.
        for (const path of ['cpu.cache.l2Bytes', 'cpu.cache.l3Bytes']) {
            const parts = path.split('.');
            let cur = snap;
            for (const p of parts) cur = cur?.[p];
            if (cur && cur.value === 0 && cur.confidence === 'high' && /not|un|denied|unavailable/i.test(cur.unknownReason || '')) {
                errors.push(`${path}: must not report fake 0 when unknown`);
            }
        }
    }

    if (!snap.memory || typeof snap.memory !== 'object') {
        errors.push('memory required');
    } else {
        checkField(snap.memory.totalBytes, 'memory.totalBytes', errors, 'number', true);
        checkField(snap.memory.availableBytes, 'memory.availableBytes', errors, 'number', true);
        checkField(snap.memory.processLimitBytes, 'memory.processLimitBytes', errors, 'number');
        for (const key of ['totalBytes', 'availableBytes', 'processLimitBytes']) {
            const f = snap.memory[key];
            if (f && f.value === 0 && f.confidence === 'unknown') {
                errors.push(`memory.${key}: unknown must use null value, not 0`);
            }
        }
    }

    if (snap.power) {
        checkField(snap.power.onAc, 'power.onAc', errors, 'boolean');
        checkField(snap.power.batteryPresent, 'power.batteryPresent', errors, 'boolean');
    }
    if (snap.sensors) {
        checkField(snap.sensors.thermalReadable, 'sensors.thermalReadable', errors, 'boolean');
        checkField(snap.sensors.powerReadable, 'sensors.powerReadable', errors, 'boolean');
    }
    if (Array.isArray(snap.invalidationHints)) {
        for (const h of snap.invalidationHints) {
            if (!INVALIDATION.has(h)) errors.push(`invalidationHints unknown: ${h}`);
        }
    }

    if (errors.length) return { ok: false, errors };
    return { ok: true, snapshot: snap };
}

function checkField(f, path, errors, valueType, required = false) {
    if (f == null) {
        if (required) errors.push(`${path} required`);
        return;
    }
    if (typeof f !== 'object' || Array.isArray(f)) {
        errors.push(`${path} must be a field object`);
        return;
    }
    if (typeof f.source !== 'string' || !f.source) errors.push(`${path}.source required`);
    if (typeof f.timestamp !== 'string') errors.push(`${path}.timestamp required`);
    if (!CONFIDENCE.has(f.confidence)) errors.push(`${path}.confidence invalid`);
    if (f.value != null) {
        if (valueType === 'number' && (!Number.isInteger(f.value) || f.value < 0)) {
            errors.push(`${path}.value must be non-negative integer or null`);
        }
        if (valueType === 'boolean' && typeof f.value !== 'boolean') {
            errors.push(`${path}.value must be boolean or null`);
        }
        if (valueType === 'string' && typeof f.value !== 'string') {
            errors.push(`${path}.value must be string or null`);
        }
    } else if (f.confidence !== 'unknown' && !f.unknownReason) {
        // null value should normally be unknown
        errors.push(`${path}: null value requires confidence=unknown or unknownReason`);
    }
}

/**
 * Build a minimal live-ish snapshot for browser / Node without privileged APIs.
 * Confidence stays low/medium — never pretends topology is known.
 */
export function probeWebLikeHardware(nav = globalThis.navigator, opts = {}) {
    const ts = new Date().toISOString();
    const logical = Math.max(1, Number(nav?.hardwareConcurrency) || Number(opts.logicalCpus) || 1);
    const deviceMemGiB = typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : null;
    const arch = opts.arch || (typeof process !== 'undefined' ? process.arch : 'unknown');
    const os = opts.os || (typeof process !== 'undefined' ? process.platform : 'web');

    return {
        schemaVersion: 1,
        capturedAt: ts,
        evidenceKind: opts.evidenceKind || 'live',
        platform: {
            os,
            osVersion: unknownField('web-ua-not-trusted'),
            arch: String(arch),
            abi: unknownField('not-exposed-in-browser'),
            containerOrVm: unknownField('not-detectable-in-browser')
        },
        cpu: {
            name: unknownField('not-exposed-in-browser'),
            logical: field(logical, 'navigator.hardwareConcurrency', nav?.hardwareConcurrency ? 'medium' : 'low', null, ts),
            physical: unknownField('not-exposed-in-browser'),
            allowed: field(logical, 'assume-all-logical', 'low', 'no-affinity-api', ts),
            smt: unknownField('not-exposed-in-browser'),
            heterogeneous: unknownField('not-exposed-in-browser'),
            coreGroups: {
                value: null,
                source: 'none',
                timestamp: ts,
                confidence: 'unknown',
                unknownReason: 'topology-not-exposed'
            },
            cache: {
                l2Bytes: unknownField('not-exposed-in-browser'),
                l3Bytes: unknownField('not-exposed-in-browser')
            },
            numaNodes: unknownField('not-exposed-in-browser')
        },
        memory: {
            totalBytes: deviceMemGiB != null
                ? field(Math.round(deviceMemGiB * 1024 * 1024 * 1024), 'navigator.deviceMemory', 'low', 'approx-gib-bucket', ts)
                : unknownField('deviceMemory-unavailable'),
            availableBytes: unknownField('not-exposed-in-browser'),
            processLimitBytes: unknownField('not-exposed-in-browser')
        },
        power: {
            onAc: unknownField('not-probed'),
            batteryPresent: unknownField('not-probed')
        },
        sensors: {
            thermalReadable: field(false, 'web-capability', 'high', null, ts),
            powerReadable: field(false, 'web-capability', 'high', null, ts)
        },
        engine: {
            abiSupported: field(true, 'assume-js', 'medium', null, ts),
            flags: ['web-hardwareConcurrency-only']
        },
        invalidationHints: ['hotplug', 'memory-pressure']
    };
}
