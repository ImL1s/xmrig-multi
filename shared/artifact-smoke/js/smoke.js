/**
 * Artifact smoke checks (#64).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {object} opts
 * @returns {{ ok: boolean, checks: object[], residual: string[] }}
 */
export function smokeWebDist(distDir) {
    const checks = [];
    const residual = [];

    if (!distDir || !existsSync(distDir)) {
        return {
            ok: false,
            checks: [{ id: 'web-dist-exists', ok: false, detail: `missing ${distDir}` }],
            residual: ['Build web dist before smoke']
        };
    }

    const index = join(distDir, 'index.html');
    const indexOk = existsSync(index);
    checks.push({ id: 'index.html', ok: indexOk, detail: index });

    let html = '';
    if (indexOk) {
        html = readFileSync(index, 'utf8');
        checks.push({
            id: 'has-start-control',
            ok: /start|開始/i.test(html),
            detail: 'Start control marker'
        });
        checks.push({
            id: 'no-embedded-user-wallet',
            ok: !/8AfUwcnoJiRDMXnDGj3zX6bMgfaj9pM1WFGr2pakLm3jSYXVLD5fcDMBzkmk4AeSqWYQTA5aerXJ43W65AT82RMqG6NDBnC/.test(html),
            detail: 'Dev fee wallet must not appear as user payout default in index'
        });
    }

    const assets = listFiles(distDir).filter((f) => /\.(js|mjs|wasm)$/i.test(f));
    checks.push({
        id: 'has-js-or-wasm',
        ok: assets.length > 0,
        detail: `${assets.length} js/wasm files`
    });

    residual.push('APK/installer/iOS .a binary hash smoke requires platform build artifacts');
    residual.push('Live accepted-share proof stays out of public CI');

    return { ok: checks.every((c) => c.ok), checks, residual };
}

/**
 * Validate release capability manifest vs harness doc presence.
 */
export function smokeManifestConsistency(manifest, harnessMd) {
    const checks = [];
    const catalog = manifest?.evidenceCatalog || {};
    for (const [id, entry] of Object.entries(catalog)) {
        const cmd = String(entry.command || '');
        const pending = /pending/i.test(cmd);
        checks.push({
            id: `evidence-${id}`,
            ok: !pending && cmd.length > 0,
            detail: cmd
        });
    }
    if (typeof harnessMd === 'string') {
        checks.push({
            id: 'harness-lists-layers',
            ok: /contract/i.test(harnessMd) && /artifact/i.test(harnessMd),
            detail: 'docs/harness.md mentions contract + artifact'
        });
    }
    return { ok: checks.every((c) => c.ok), checks };
}

function listFiles(dir, acc = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) listFiles(p, acc);
        else acc.push(p);
    }
    return acc;
}

// CLI
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
    process.argv[1] && process.argv[1].endsWith('smoke.js')) {
    const args = process.argv.slice(2);
    const idx = args.indexOf('--web-dist');
    const dist = idx >= 0 ? args[idx + 1] : 'web/dist';
    const result = smokeWebDist(dist);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
}
