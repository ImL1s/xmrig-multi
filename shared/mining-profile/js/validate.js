/**
 * Lightweight MiningProfile v1 validator (no external schema lib).
 * Rejects unknown future schemaVersion; strips unknown keys on migrate path separately.
 */

const ENGINES = new Set(['xmrig', 'randomx-js', 'dero-miner', 'unknown']);
const COINS = new Set(['monero', 'wownero', 'dero']);
const ASSETS = new Set(['XMR', 'WOW', 'DERO']);
const ENDPOINT_TYPES = new Set(['stratum', 'daemon', 'p2pool', 'web-proxy']);
const CPU_MODES = new Set(['auto', 'manual']);
const RX_MODES = new Set(['auto', 'fast', 'light']);

const KNOWN_TOP_KEYS = new Set([
    'schemaVersion', 'id', 'name', 'engine', 'coin', 'payoutAsset',
    'endpoint', 'account', 'cpu', 'randomx', 'network', 'power', 'thermal',
    'locks', 'donateLevel'
]);

/**
 * @param {unknown} profile
 * @returns {{ ok: true, profile: object, unknownKeys: string[] } | { ok: false, errors: string[] }}
 */
export function validateMiningProfile(profile) {
    const errors = [];
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
        return { ok: false, errors: ['profile must be an object'] };
    }

    const unknownKeys = Object.keys(profile).filter((k) => !KNOWN_TOP_KEYS.has(k));

    if (profile.schemaVersion === undefined || profile.schemaVersion === null) {
        errors.push('schemaVersion is required');
    } else if (typeof profile.schemaVersion !== 'number' || !Number.isInteger(profile.schemaVersion)) {
        errors.push('schemaVersion must be an integer');
    } else if (profile.schemaVersion > 1) {
        errors.push(`unsupported future schemaVersion ${profile.schemaVersion}; open read-only or refuse`);
    } else if (profile.schemaVersion < 1) {
        errors.push(`schemaVersion ${profile.schemaVersion} is too old to load`);
    }

    if (typeof profile.id !== 'string' || !profile.id.trim()) {
        errors.push('id must be a non-empty string');
    }
    if (!ENGINES.has(profile.engine)) {
        errors.push(`engine must be one of ${[...ENGINES].join(', ')}`);
    }
    if (!COINS.has(profile.coin)) {
        errors.push(`coin must be one of ${[...COINS].join(', ')}`);
    }
    if (!ASSETS.has(profile.payoutAsset)) {
        errors.push(`payoutAsset must be one of ${[...ASSETS].join(', ')}`);
    }

    const ep = profile.endpoint;
    if (!ep || typeof ep !== 'object') {
        errors.push('endpoint is required');
    } else {
        if (!ENDPOINT_TYPES.has(ep.type)) {
            errors.push('endpoint.type invalid');
        }
        if (typeof ep.url !== 'string' || !ep.url.trim()) {
            errors.push('endpoint.url required');
        }
        if (ep.tls != null && typeof ep.tls !== 'boolean') {
            errors.push('endpoint.tls must be boolean or null');
        }
    }

    const acct = profile.account;
    if (!acct || typeof acct !== 'object') {
        errors.push('account is required');
    } else if (typeof acct.user !== 'string') {
        errors.push('account.user must be a string');
    }

    const cpu = profile.cpu;
    if (!cpu || typeof cpu !== 'object') {
        errors.push('cpu is required');
    } else {
        if (!CPU_MODES.has(cpu.mode)) {
            errors.push('cpu.mode must be auto|manual');
        }
        if (cpu.mode === 'manual') {
            if (cpu.threads == null || !Number.isInteger(cpu.threads) || cpu.threads < 1) {
                errors.push('cpu.threads must be a positive integer when mode=manual');
            }
        }
        if (cpu.mode === 'auto' && cpu.threads != null) {
            errors.push('cpu.threads must be null when mode=auto (do not overload one field)');
        }
        if (cpu.maxThreadsHintPercent != null) {
            const h = cpu.maxThreadsHintPercent;
            if (!Number.isInteger(h) || h < 1 || h > 100) {
                errors.push('cpu.maxThreadsHintPercent must be 1..100 or null');
            }
        }
        if (cpu.affinity != null && !Array.isArray(cpu.affinity)) {
            errors.push('cpu.affinity must be an array or null');
        }
    }

    if (profile.randomx?.mode != null && !RX_MODES.has(profile.randomx.mode)) {
        errors.push('randomx.mode invalid');
    }

    if (profile.donateLevel != null) {
        const d = profile.donateLevel;
        if (!Number.isInteger(d) || d < 0 || d > 100) {
            errors.push('donateLevel must be 0..100');
        }
    }

    if (errors.length) {
        return { ok: false, errors };
    }
    return { ok: true, profile, unknownKeys };
}

/**
 * Migrate older / partial shapes into schemaVersion 1 without wiping user values.
 * @param {object} raw
 */
export function migrateToV1(raw) {
    if (!raw || typeof raw !== 'object') {
        throw new Error('cannot migrate non-object');
    }
    if (raw.schemaVersion != null && raw.schemaVersion > 1) {
        const err = new Error(`refuse migrate from future schemaVersion ${raw.schemaVersion}`);
        err.code = 'FUTURE_SCHEMA';
        throw err;
    }

    const coin = normalizeCoin(raw.coin || raw.coinType || 'monero');
    const payoutAsset = raw.payoutAsset || defaultAsset(coin);
    const cpuMode = raw.cpu?.mode
        ?? (raw.threadsAuto === true || raw.threads === 0 || raw.threads === -1 ? 'auto' : 'manual');

    return {
        schemaVersion: 1,
        id: String(raw.id || 'default'),
        name: raw.name || 'Default',
        engine: raw.engine || 'xmrig',
        coin,
        payoutAsset,
        endpoint: {
            type: raw.endpoint?.type || (raw.soloDaemon ? 'daemon' : 'stratum'),
            url: raw.endpoint?.url || raw.poolUrl || raw.pool_url || '',
            tls: raw.endpoint?.tls ?? (typeof raw.useTls === 'boolean' ? raw.useTls : null),
            poolId: raw.endpoint?.poolId ?? raw.poolId ?? null
        },
        account: {
            user: raw.account?.user ?? raw.walletAddress ?? raw.wallet_address ?? '',
            pass: raw.account?.pass ?? raw.workerName ?? raw.worker_name ?? 'x',
            rigId: raw.account?.rigId ?? null
        },
        cpu: {
            mode: cpuMode,
            threads: cpuMode === 'manual'
                ? (raw.cpu?.threads ?? raw.threads ?? null)
                : null,
            maxThreadsHintPercent: cpuMode === 'auto'
                ? pickHint(raw)
                : (raw.cpu?.maxThreadsHintPercent ?? null),
            affinity: raw.cpu?.affinity ?? null
        },
        randomx: {
            mode: raw.randomx?.mode || (coin === 'wownero' ? 'light' : 'auto')
        },
        network: {
            autoReconnect: raw.network?.autoReconnect ?? raw.autoReconnect ?? true,
            retries: raw.network?.retries ?? raw.retries ?? 5,
            retryPauseSec: raw.network?.retryPauseSec ?? raw.retryPause ?? 5
        },
        power: raw.power || {},
        thermal: raw.thermal || {},
        locks: { fields: [...(raw.locks?.fields || [])] },
        donateLevel: raw.donateLevel ?? 1
    };
}

function normalizeCoin(c) {
    const s = String(c).toLowerCase();
    if (s.includes('wow')) return 'wownero';
    if (s.includes('dero')) return 'dero';
    return 'monero';
}

function defaultAsset(coin) {
    if (coin === 'wownero') return 'WOW';
    if (coin === 'dero') return 'DERO';
    return 'XMR';
}

/** Prefer explicit cpu hint; else legacy maxCpuUsage; else leave null for compile fallback/tune. */
function pickHint(raw) {
    if (raw.cpu && Object.prototype.hasOwnProperty.call(raw.cpu, 'maxThreadsHintPercent')) {
        return raw.cpu.maxThreadsHintPercent;
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'maxCpuUsage')) {
        return raw.maxCpuUsage;
    }
    return null;
}
