/**
 * Load and summarize fee manifest for UI (#63).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEE_DEFAULTS, describeBasis } from './time-window.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadFeeManifest(path = join(root, 'manifest.v1.json')) {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    validateManifest(raw);
    return raw;
}

export function validateManifest(m) {
    if (m.schemaVersion !== 1) throw new Error('unsupported fee manifest schema');
    if (m.developerWallet !== FEE_DEFAULTS.wallet) {
        throw new Error('developerWallet mismatch vs FEE_DEFAULTS');
    }
    if (m.developerPercent !== FEE_DEFAULTS.percent) {
        throw new Error('developerPercent mismatch');
    }
    if (m.cycleSeconds !== FEE_DEFAULTS.cycleSeconds ||
        m.feeDurationSeconds !== FEE_DEFAULTS.feeDurationSeconds) {
        throw new Error('time window mismatch vs FEE_DEFAULTS');
    }
    for (const [id, platform] of Object.entries(m.platforms || {})) {
        if (!Array.isArray(platform.layers) || !platform.layers.length) {
            throw new Error(`${id}: layers required`);
        }
        for (const layer of platform.layers) {
            if (layer.ratePercent === 0 && layer.kind === 'pool') {
                throw new Error(`${id}: pool fee must not be hardcoded 0 when unknown`);
            }
        }
    }
    return true;
}

/**
 * @param {object} manifest
 * @param {string} platform android|desktop|ios|web
 * @param {{ poolFeePercent?: number|null, poolFeeKnown?: boolean }} [ctx]
 */
export function summarizeFees(manifest, platform, ctx = {}) {
    const p = manifest.platforms[platform];
    if (!p) {
        return {
            ok: false,
            platform,
            lines: [`Unknown platform ${platform}`],
            mismatch: false,
            layers: []
        };
    }
    const lines = [];
    const layers = [];
    if (p.mismatch) {
        lines.push(`⚠ Artifact mismatch: ${p.mismatchNote || 'rebuild required for project fee'}`);
    }
    lines.push(`Basis: ${describeBasis(manifest.basis)}`);
    for (const layer of p.layers) {
        let rateLabel;
        if (layer.kind === 'pool') {
            if (ctx.poolFeeKnown && ctx.poolFeePercent != null) {
                rateLabel = `${ctx.poolFeePercent}%`;
            } else {
                rateLabel = 'unknown (not 0%)';
            }
        } else if (layer.ratePercent == null) {
            rateLabel = 'unknown (not 0%)';
        } else {
            rateLabel = `${layer.ratePercent}% (${layer.basis})`;
        }
        const adjustable = layer.adjustable ? 'user-adjustable' : 'mandatory/read-only';
        const line = `${layer.kind}: ${rateLabel} — ${adjustable}` +
            (layer.note ? ` — ${layer.note}` : '');
        lines.push(line);
        layers.push({
            id: layer.id,
            kind: layer.kind,
            rateLabel,
            adjustable: !!layer.adjustable,
            beneficiary: layer.beneficiary,
            implementation: layer.implementation
        });
    }
    if (p.stackingNote) lines.push(p.stackingNote);
    return {
        ok: true,
        platform,
        engineProvenance: p.engineProvenance,
        mismatch: !!p.mismatch,
        lines,
        layers,
        developerWallet: manifest.developerWallet
    };
}
