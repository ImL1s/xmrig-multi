/**
 * Pool registry loader / validator (#40).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KINDS = new Set(['stratum-pool', 'p2pool', 'monero-daemon', 'dero-node', 'web-proxy']);
const STATUSES = new Set(['verified', 'docs-verified', 'unverified', 'deprecated', 'unavailable']);
const CHAINS = new Set(['monero', 'wownero', 'dero']);
const ASSETS = new Set(['XMR', 'WOW', 'DERO']);

export function registryPath() {
    return join(ROOT, 'registry.v1.json');
}

export function loadRegistry(path = registryPath()) {
    const raw = readFileSync(path, 'utf8');
    const data = JSON.parse(raw);
    const result = validateRegistry(data);
    if (!result.ok) {
        const err = new Error(result.errors.join('; '));
        err.errors = result.errors;
        throw err;
    }
    return {
        registry: data,
        hash: canonicalRegistryHash(data),
        path
    };
}

/** Hash parsed registry so Windows CRLF checkouts do not drift from Linux CI. */
export function canonicalRegistryHash(registry) {
    return createHash('sha256').update(stableStringify(registry)).digest('hex');
}

/** @deprecated use canonicalRegistryHash for cross-platform stability */
export function registryHash(rawText) {
    return createHash('sha256').update(String(rawText).replace(/\r\n/g, '\n')).digest('hex');
}

function stableStringify(v) {
    if (v === null || typeof v !== 'object') {
        return JSON.stringify(v);
    }
    if (Array.isArray(v)) {
        return `[${v.map(stableStringify).join(',')}]`;
    }
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

export function validateRegistry(data) {
    const errors = [];
    if (!data || typeof data !== 'object') {
        return { ok: false, errors: ['registry must be an object'] };
    }
    if (data.schemaVersion !== 1) {
        errors.push(`schemaVersion must be 1, got ${data.schemaVersion}`);
    }
    if (!Array.isArray(data.entries) || data.entries.length === 0) {
        errors.push('entries must be a non-empty array');
    }

    const ids = new Set();
    for (const e of data.entries || []) {
        if (!e.id || typeof e.id !== 'string') {
            errors.push('entry missing id');
            continue;
        }
        if (ids.has(e.id)) {
            errors.push(`duplicate id ${e.id}`);
        }
        ids.add(e.id);

        if (!KINDS.has(e.kind)) errors.push(`${e.id}: invalid kind`);
        if (!STATUSES.has(e.status)) errors.push(`${e.id}: invalid status`);
        if (!CHAINS.has(e.miningChain)) errors.push(`${e.id}: invalid miningChain`);
        if (!ASSETS.has(e.payoutAsset)) errors.push(`${e.id}: invalid payoutAsset`);
        if (!Array.isArray(e.endpoints) || e.endpoints.length === 0) {
            errors.push(`${e.id}: endpoints required`);
        }
        if (!e.lastReviewedAt) errors.push(`${e.id}: lastReviewedAt required`);
        if (typeof e.noviceDefault !== 'boolean') errors.push(`${e.id}: noviceDefault required`);

        // Fee integrity: never encode unknown as numeric 0 pretending known
        const fee = e.fees?.poolFee;
        if (fee) {
            if (fee.status === 'unknown' && fee.percent != null) {
                errors.push(`${e.id}: unknown poolFee must not set percent`);
            }
            if (fee.status === 'known' && (fee.percent == null || fee.asOf == null)) {
                errors.push(`${e.id}: known poolFee needs percent + asOf`);
            }
        }

        // Kind / transport consistency
        for (const ep of e.endpoints || []) {
            if (e.kind === 'dero-node' && ep.transport !== 'daemon-rpc') {
                errors.push(`${e.id}/${ep.id}: dero-node requires daemon-rpc`);
            }
            if (e.kind === 'stratum-pool' && !String(ep.transport).startsWith('stratum')) {
                errors.push(`${e.id}/${ep.id}: stratum-pool requires stratum transport`);
            }
            if (ep.tls === true && ep.transport === 'stratum-tcp') {
                errors.push(`${e.id}/${ep.id}: tls=true incompatible with stratum-tcp`);
            }
        }

        // Novice defaults must not be unverified/unavailable/deprecated
        if (e.noviceDefault && !['verified', 'docs-verified'].includes(e.status)) {
            errors.push(`${e.id}: noviceDefault only for verified|docs-verified`);
        }

        // MoneroOcean payout asset hard rule
        if (e.id === 'moneroocean' && e.payoutAsset !== 'XMR') {
            errors.push('moneroocean must payout XMR');
        }
    }

    return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

/** Android legacy pools.json shape derived from registry. */
export function toAndroidPoolsJson(registry) {
    return registry.entries.map((e) => {
        const plain = e.endpoints.find((x) => !x.tls) || e.endpoints[0];
        const tls = e.endpoints.find((x) => x.tls) || plain;
        const status = mapAndroidStatus(e.status);
        const feeLabel = e.fees?.poolFee?.status === 'known'
            ? `${e.fees.poolFee.percent}%`
            : 'unknown';
        return {
            id: e.id,
            name: e.displayName,
            url: `${plain.host}:${plain.port}`,
            ssl_url: `${tls.host}:${tls.port}`,
            description: e.description || e.disposition || '',
            fee: feeLabel,
            coin: e.miningChain.toUpperCase(),
            status,
            payout_asset: e.payoutAsset,
            kind: e.kind,
            registry_status: e.status,
            last_reviewed_at: e.lastReviewedAt,
            novice_default: e.noviceDefault
        };
    });
}

/** Desktop coin → pool list. */
export function toDesktopPoolConfigs(registry) {
    const out = { monero: [], wownero: [], dero: [] };
    for (const e of registry.entries) {
        const plain = e.endpoints.find((x) => !x.tls) || e.endpoints[0];
        const desktopStatus = mapDesktopStatus(e.status, e.kind);
        const startAllowed = desktopStatus === 'supported' || desktopStatus === 'unverified';
        const row = {
            id: e.id,
            url: startAllowed ? `${plain.host}:${plain.port}` : '',
            name: e.displayName + (desktopStatus === 'supported' ? '' : ` (${e.status})`),
            algo: e.algorithms[0] || '',
            status: desktopStatus === 'unverified' ? 'supported' : desktopStatus,
            // Keep registry truth for UI that wants to show warnings
            registry_status: e.status,
            payout_asset: e.payoutAsset,
            kind: e.kind
        };
        // WOW/DERO stay non-startable at engine layer; blank URL for unavailable kinds
        if (desktopStatus === 'unavailable') {
            row.url = '';
            row.status = 'unavailable';
        }
        out[e.miningChain].push(row);
    }
    if (out.wownero.length === 0) {
        out.wownero.push({
            id: 'wownero-unavailable',
            url: '',
            name: 'Wownero unavailable — need signer/daemon (#28)',
            algo: 'rx/wow',
            status: 'unavailable'
        });
    }
    if (out.dero.length === 0) {
        out.dero.push({
            id: 'dero-unavailable',
            url: '',
            name: 'DERO unavailable — need daemon adapter (#27)',
            algo: 'astrobwt/v3',
            status: 'unavailable'
        });
    }
    return out;
}

function mapAndroidStatus(status) {
    if (status === 'verified' || status === 'docs-verified') return 'supported';
    if (status === 'deprecated') return 'unavailable';
    if (status === 'unverified') return 'unverified';
    return 'unavailable';
}

function mapDesktopStatus(status, kind) {
    if (kind === 'dero-node' || kind === 'p2pool') {
        // Not wired as Stratum presets in desktop yet
        return 'unavailable';
    }
    if (status === 'verified' || status === 'docs-verified') return 'supported';
    if (status === 'unverified') return 'unverified';
    return 'unavailable';
}
