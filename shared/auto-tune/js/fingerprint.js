/**
 * Capability fingerprint for auto-tune result validity (#34).
 */

import { createHash } from 'node:crypto';

/**
 * @param {object} input
 * @param {object} [input.snapshot] HardwareSnapshot-like
 * @param {string} [input.engineBuild]
 * @param {string} [input.algorithm]
 * @param {object} [input.powerPolicy]
 * @param {object} [input.memoryPolicy]
 */
export function tuneFingerprint(input = {}) {
    const snap = input.snapshot || {};
    const cpu = snap.cpu || {};
    const mem = snap.memory || {};
    const payload = {
        logical: cpu.logical?.value ?? null,
        physical: cpu.physical?.value ?? null,
        allowed: cpu.allowed?.value ?? null,
        smt: cpu.smt?.value ?? null,
        heterogeneous: cpu.heterogeneous?.value ?? null,
        memTotal: mem.totalBytes?.value ?? null,
        processLimit: mem.processLimitBytes?.value ?? null,
        engineBuild: input.engineBuild || 'unknown',
        algorithm: input.algorithm || 'rx/0',
        powerPolicy: input.powerPolicy || {},
        memoryPolicy: input.memoryPolicy || {}
    };
    const json = JSON.stringify(payload);
    const hash = createHash('sha256').update(json).digest('hex').slice(0, 16);
    return { hash, payload };
}

/**
 * @param {string} savedHash
 * @param {ReturnType<typeof tuneFingerprint>} current
 */
export function isFingerprintStale(savedHash, current) {
    if (!savedHash || !current?.hash) return true;
    return savedHash !== current.hash;
}
