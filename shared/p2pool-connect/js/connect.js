/**
 * P2Pool "connect existing" wizard helpers (#45).
 * Stratum (miner) and monerod RPC are separate — never set daemon:true on Stratum.
 */

export const P2POOL_DEFAULTS = Object.freeze({
    stratumPort: 3333,
    monerodRpcPort: 18081,
    sidechains: ['main', 'mini'],
    docs: {
        p2pool: { label: 'p2pool.io', url: 'https://p2pool.io/', asOf: '2026-09-06' },
        getmonero: {
            label: 'getmonero.org mining',
            url: 'https://www.getmonero.org/get-started/mining/',
            asOf: '2026-09-06'
        }
    },
    feeNote:
        'P2Pool has no centralized pool fee; payout timing depends on sidechain luck and hashrate. Not a payment guarantee.'
});

/**
 * Parse a trusted local/LAN P2Pool stratum host:port (no daemon flag).
 * @param {string} input
 * @param {{ allowRemote?: boolean }} [opts]
 */
export function parseP2PoolStratumEndpoint(input, opts = {}) {
    const raw = String(input || '').trim();
    if (!raw) {
        return { ok: false, code: 'empty', message: 'P2Pool Stratum endpoint required' };
    }
    // Reject URI schemes that look like monerod RPC
    if (/^https?:\/\//i.test(raw) || /\/json_rpc/i.test(raw)) {
        return {
            ok: false,
            code: 'looks_like_rpc',
            message: 'This looks like monerod RPC — use the Stratum port (often 3333), not 18081'
        };
    }

    let host;
    let port;
    if (raw.startsWith('[')) {
        const m = raw.match(/^\[([^\]]+)\]:(\d+)$/);
        if (!m) return { ok: false, code: 'bad_ipv6', message: 'Expected [IPv6]:port' };
        host = m[1];
        port = Number(m[2]);
    } else {
        const idx = raw.lastIndexOf(':');
        if (idx <= 0) {
            host = raw;
            port = P2POOL_DEFAULTS.stratumPort;
        } else {
            host = raw.slice(0, idx);
            port = Number(raw.slice(idx + 1));
        }
    }

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return { ok: false, code: 'bad_port', message: 'Invalid Stratum port' };
    }

    const trust = classifyHostTrust(host, opts.allowRemote === true);
    if (!trust.ok) return trust;

    return {
        ok: true,
        host,
        port,
        url: host.includes(':') && !host.startsWith('[') ? `[${host}]:${port}` : `${host}:${port}`,
        trust: trust.trust,
        /** Critical: stratum pool config must NOT set daemon:true */
        xmrigPool: {
            url: host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`,
            daemon: false,
            tls: false,
            keepalive: true
        }
    };
}

/**
 * Parse monerod RPC separately from Stratum.
 * @param {string} input
 */
export function parseMonerodRpcEndpoint(input) {
    const raw = String(input || '').trim();
    if (!raw) {
        return { ok: false, code: 'empty', message: 'monerod RPC endpoint optional but empty' };
    }
    // Reuse loose host:port / http URL forms — path ok for RPC
    let host = raw;
    let port = P2POOL_DEFAULTS.monerodRpcPort;
    let scheme = 'http';

    if (/^https:\/\//i.test(raw)) {
        return { ok: false, code: 'https_unsupported', message: 'HTTPS monerod RPC not supported in this wizard yet' };
    }
    if (/^http:\/\//i.test(raw)) {
        try {
            const u = new URL(raw);
            host = u.hostname;
            port = u.port ? Number(u.port) : P2POOL_DEFAULTS.monerodRpcPort;
            scheme = 'http';
        } catch {
            return { ok: false, code: 'bad_url', message: 'Invalid monerod RPC URL' };
        }
    } else if (raw.startsWith('[')) {
        const m = raw.match(/^\[([^\]]+)\]:(\d+)$/);
        if (!m) return { ok: false, code: 'bad_ipv6', message: 'Expected [IPv6]:port' };
        host = m[1];
        port = Number(m[2]);
    } else if (raw.includes(':')) {
        const idx = raw.lastIndexOf(':');
        host = raw.slice(0, idx);
        port = Number(raw.slice(idx + 1));
    }

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return { ok: false, code: 'bad_port', message: 'Invalid monerod RPC port' };
    }

    const trust = classifyHostTrust(host, false);
    if (!trust.ok) return trust;

    return {
        ok: true,
        host,
        port,
        scheme,
        url: `${scheme}://${host}:${port}/json_rpc`,
        trust: trust.trust,
        role: 'monerod-rpc'
    };
}

function classifyHostTrust(host, allowRemote) {
    const h = String(host).toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1') {
        return { ok: true, trust: 'loopback' };
    }
    // Private LAN ranges
    if (
        /^10\.\d+\.\d+\.\d+$/.test(h) ||
        /^192\.168\.\d+\.\d+$/.test(h) ||
        /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(h) ||
        /^fc[0-9a-f]{2}:/i.test(h) ||
        /^fd[0-9a-f]{2}:/i.test(h)
    ) {
        return { ok: true, trust: 'lan' };
    }
    if (allowRemote) {
        return { ok: true, trust: 'remote-explicit' };
    }
    return {
        ok: false,
        code: 'untrusted_host',
        message: 'Only loopback or trusted LAN hosts allowed for connect-existing (no public P2Pool scan)'
    };
}

/**
 * Evaluate layered status from fixtures / probe results.
 * @param {{ monerod?: object|null, p2pool?: object|null, miner?: object|null }} layers
 */
export function evaluateP2PoolStack(layers = {}) {
    const monerod = normalizeLayer(layers.monerod, 'monerod');
    const p2pool = normalizeLayer(layers.p2pool, 'p2pool');
    const miner = normalizeLayer(layers.miner, 'miner');

    const ready =
        monerod.code === 'synced' &&
        p2pool.code === 'sidechain_synced' &&
        (miner.code === 'idle' || miner.code === 'hashing');

    return {
        monerod,
        p2pool,
        miner,
        readyToMine: ready,
        summary: ready
            ? 'monerod + P2Pool sidechain ready'
            : [monerod, p2pool, miner]
                .filter((l) => l.code !== 'synced' && l.code !== 'sidechain_synced' && l.code !== 'idle' && l.code !== 'hashing')
                .map((l) => `${l.layer}: ${l.message}`)
                .join('; ') || 'Not ready'
    };
}

function normalizeLayer(raw, layer) {
    if (!raw) {
        return { layer, code: 'unknown', message: `${layer} status unknown`, ok: false };
    }
    return {
        layer,
        code: raw.code || 'unknown',
        message: raw.message || raw.code || 'unknown',
        ok: Boolean(raw.ok),
        detail: raw.detail || null
    };
}

/**
 * Build XMRig pool JSON fragment for an existing P2Pool Stratum — never daemon mode.
 * @param {{ stratum: ReturnType<typeof parseP2PoolStratumEndpoint>, wallet: string, worker?: string, sidechain?: string }} input
 */
export function buildP2PoolMinerConfig(input) {
    const { stratum, wallet, worker = 'x', sidechain = 'main' } = input || {};
    if (!stratum?.ok) {
        return { ok: false, code: 'bad_stratum', message: stratum?.message || 'Invalid Stratum' };
    }
    if (!wallet || typeof wallet !== 'string' || wallet.trim().length < 95) {
        return { ok: false, code: 'bad_wallet', message: 'Primary Monero address required (subaddress policy: pass as user per current P2Pool docs)' };
    }
    if (!P2POOL_DEFAULTS.sidechains.includes(sidechain)) {
        return { ok: false, code: 'bad_sidechain', message: 'sidechain must be main or mini' };
    }

    const pool = {
        ...stratum.xmrigPool,
        user: wallet.trim(),
        pass: worker,
        // Explicit sentinel — tests assert this stays false
        'daemon': false
    };

    return {
        ok: true,
        sidechain,
        pool,
        fees: {
            note: P2POOL_DEFAULTS.feeNote,
            sources: [P2POOL_DEFAULTS.docs.p2pool, P2POOL_DEFAULTS.docs.getmonero]
        },
        layers: {
            miner: 'stratum → existing P2Pool',
            p2pool: 'user-managed',
            monerod: 'user-managed (status only)'
        },
        managedServices: false
    };
}

/**
 * Map fixture file payloads into stack evaluation.
 * @param {object} fixture
 */
export function evaluateFixture(fixture) {
    return evaluateP2PoolStack({
        monerod: fixture.monerod,
        p2pool: fixture.p2pool,
        miner: fixture.miner
    });
}
