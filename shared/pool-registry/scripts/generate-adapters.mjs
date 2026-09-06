#!/usr/bin/env node
/**
 * Generate platform adapters from shared/pool-registry/registry.v1.json (#40).
 * Run from repo root: node shared/pool-registry/scripts/generate-adapters.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    loadRegistry,
    toAndroidPoolsJson,
    toDesktopPoolConfigs
} from '../js/load.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { registry, hash } = loadRegistry();

const android = toAndroidPoolsJson(registry);
const androidPath = join(ROOT, 'app', 'src', 'main', 'assets', 'pools.json');
writeFileSync(androidPath, `${JSON.stringify(android, null, 2)}\n`, 'utf8');

const desktop = {
    schemaVersion: 1,
    registryHash: hash,
    generatedAt: registry.generatedAt,
    poolConfigs: toDesktopPoolConfigs(registry)
};
const genDir = join(ROOT, 'shared', 'pool-registry', 'generated');
mkdirSync(genDir, { recursive: true });
const desktopPath = join(genDir, 'desktop-pool-configs.json');
writeFileSync(desktopPath, `${JSON.stringify(desktop, null, 2)}\n`, 'utf8');

const desktopSrcPath = join(ROOT, 'desktop', 'src', 'generated-pool-configs.json');
writeFileSync(desktopSrcPath, `${JSON.stringify(desktop, null, 2)}\n`, 'utf8');

const metaPath = join(genDir, 'registry.meta.json');
writeFileSync(
    metaPath,
    `${JSON.stringify({
        schemaVersion: registry.schemaVersion,
        registryHash: hash,
        entryCount: registry.entries.length,
        generatedAt: new Date().toISOString()
    }, null, 2)}\n`,
    'utf8'
);

// iOS Swift snippet (checked into generated/; maintainers paste or codegen later)
const iosLines = [
    '// AUTO-GENERATED from shared/pool-registry — do not hand-edit presets here.',
    `// registryHash: ${hash}`,
    'enum PoolRegistryPresets {',
    '    // Prefer loading registry JSON in a follow-up; constants keep compile-time visibility.',
    ...registry.entries.map((e) => {
        const ep = e.endpoints.find((x) => !x.tls) || e.endpoints[0];
        return `    // ${e.id}: ${ep.host}:${ep.port} status=${e.status} kind=${e.kind}`;
    }),
    '}'
];
writeFileSync(join(genDir, 'ios-pool-presets.comment.swift'), `${iosLines.join('\n')}\n`, 'utf8');

console.log(`Wrote ${androidPath}`);
console.log(`Wrote ${desktopPath}`);
console.log(`Wrote ${desktopSrcPath}`);
console.log(`registryHash=${hash}`);
