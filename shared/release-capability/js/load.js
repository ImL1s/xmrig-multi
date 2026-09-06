/**
 * Release capability manifest loader (#64).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadManifest(path = join(root, 'manifest.v1.json')) {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    assertConsistent(raw);
    return raw;
}

/**
 * Fail CI when supported lacks evidence, or GPU is falsely supported.
 */
export function assertConsistent(m) {
    if (!m || m.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
    if (!m.platforms || !m.evidenceCatalog) throw new Error('platforms + evidenceCatalog required');

    for (const [plat, p] of Object.entries(m.platforms)) {
        walkStatus(p, (node, path) => {
            if (node.status === 'supported' && !node.evidenceId) {
                throw new Error(`${plat}.${path}: supported requires evidenceId`);
            }
            if (node.evidenceId && !m.evidenceCatalog[node.evidenceId]) {
                throw new Error(`${plat}.${path}: unknown evidenceId ${node.evidenceId}`);
            }
        });

        for (const backend of ['opencl', 'cuda']) {
            const b = p[backend];
            if (!b) continue;
            if (b.status === 'supported' || b.status === 'experimental') {
                throw new Error(
                    `${plat}.${backend}: packaged builds currently ship WITH_OPENCL/CUDA=OFF — cannot claim ${b.status}`
                );
            }
            if (b.startable === true) {
                throw new Error(`${plat}.${backend}: startable must be false while unavailable`);
            }
        }
    }
    return true;
}

export function checklist(m = loadManifest()) {
    return {
        updated: m.updated,
        platforms: Object.keys(m.platforms),
        verified: m.releaseChecklist?.verifiedPlatforms || [],
        unverified: m.releaseChecklist?.unverifiedPlatforms || [],
        knownLimits: Object.fromEntries(
            Object.entries(m.platforms).map(([k, v]) => [k, v.knownLimits || []])
        ),
        gpuStartableAnywhere: Object.values(m.platforms).some(
            (p) => p.opencl?.startable || p.cuda?.startable
        )
    };
}

function walkStatus(obj, fn, path = '') {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    if (typeof obj.status === 'string') fn(obj, path || 'root');
    for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            walkStatus(v, fn, path ? `${path}.${k}` : k);
        }
    }
}
