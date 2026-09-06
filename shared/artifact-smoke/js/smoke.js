/**
 * Artifact **static** smoke checks (#64 / #133).
 * These are L1 HTML/file presence checks — NOT browser E2E, NOT native PoW,
 * and NOT proof that Start/Stop works. Name checks accordingly.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {object} opts
 * @returns {{ ok: boolean, layer: string, checks: object[], residual: string[] }}
 */
export function smokeWebDist(distDir) {
    const checks = [];
    const residual = [];
    const layer = 'L1-static-sanity';

    if (!distDir || !existsSync(distDir)) {
        return {
            ok: false,
            layer,
            checks: [{ id: 'static-web-dist-exists', ok: false, detail: `missing ${distDir}` }],
            residual: ['Build web dist before static smoke']
        };
    }

    const index = join(distDir, 'index.html');
    const indexOk = existsSync(index);
    checks.push({ id: 'static-index.html', ok: indexOk, detail: index });

    let html = '';
    if (indexOk) {
        html = readFileSync(index, 'utf8');
        checks.push({
            id: 'static-has-start-marker',
            ok: /start|開始/i.test(html),
            detail: 'HTML text marker only — not a UI click proof'
        });
        checks.push({
            id: 'static-no-embedded-user-wallet',
            ok: !/8AfUwcnoJiRDMXnDGj3zX6bMgfaj9pM1WFGr2pakLm3jSYXVLD5fcDMBzkmk4AeSqWYQTA5aerXJ43W65AT82RMqG6NDBnC/.test(html),
            detail: 'Dev fee wallet must not appear as user payout default in index'
        });
    }

    const assets = listFiles(distDir).filter((f) => /\.(js|mjs|wasm)$/i.test(f));
    checks.push({
        id: 'static-has-js-or-wasm',
        ok: assets.length > 0,
        detail: `${assets.length} js/wasm files`
    });

    residual.push('APK/installer/iOS .a binary hash smoke requires platform build artifacts');
    residual.push('Live accepted-share proof stays out of public CI');
    residual.push('This suite must never be reported as UI/native acceptance');

    return { ok: checks.every((c) => c.ok), layer, checks, residual };
}

/**
 * Validate release capability manifest vs harness doc presence.
 * Pending commands fail — empty strings are not evidence (#133).
 */
export function smokeManifestConsistency(manifest, harnessMd) {
    const checks = [];
    const catalog = manifest?.evidenceCatalog || {};
    for (const [id, entry] of Object.entries(catalog)) {
        const cmd = String(entry.command || '');
        const pending = /pending/i.test(cmd);
        checks.push({
            id: `static-evidence-${id}`,
            ok: !pending && cmd.length > 0,
            detail: cmd || '(empty — not evidence)'
        });
    }
    if (typeof harnessMd === 'string') {
        checks.push({
            id: 'static-harness-lists-layers',
            ok: /contract/i.test(harnessMd) && /artifact/i.test(harnessMd),
            detail: 'docs/harness.md mentions contract + artifact'
        });
    }
    return { ok: checks.every((c) => c.ok), layer: 'L1-static-sanity', checks };
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
