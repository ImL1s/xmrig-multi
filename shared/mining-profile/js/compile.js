/**
 * Reference MiningProfile compiler (#30).
 *
 * Priority (highest first):
 * 1. Safety constraints (engine/coin gates, TLS capability, payout/asset rules)
 * 2. Explicit user locks
 * 3. Accepted tune results (capabilities.acceptedTune)
 * 4. Verified presets (capabilities.presets)
 * 5. Conservative fallback
 *
 * Effective values that cannot be confirmed after launch stay `unknown`
 * — never copy requested into effective as if proven.
 */

import { createHash } from 'node:crypto';
import { migrateToV1, validateMiningProfile } from './validate.js';

/** Keys accepted on raw input (v1 + legacy Android/desktop aliases). */
const KNOWN_RAW_KEYS = new Set([
    'schemaVersion', 'id', 'name', 'engine', 'coin', 'coinType', 'payoutAsset',
    'endpoint', 'account', 'cpu', 'randomx', 'network', 'power', 'thermal',
    'locks', 'donateLevel',
    'poolUrl', 'pool_url', 'poolId', 'walletAddress', 'wallet_address',
    'workerName', 'worker_name', 'threads', 'threadsAuto', 'maxCpuUsage',
    'useTls', 'autoReconnect', 'retries', 'retryPause', 'soloDaemon'
]);

/**
 * @typedef {object} Capabilities
 * @property {string} [platform]
 * @property {string} [backend]
 * @property {Record<string, { status: string, reason?: string }>} [coins]
 * @property {boolean} [tls] whether TLS pools are supported by the binary/runtime
 * @property {object} [acceptedTune] optional previously accepted auto-tune snapshot
 * @property {object} [presets]
 */

/**
 * @typedef {object} Hardware
 * @property {number} [logicalCpus]
 * @property {number} [availableMemoryMb]
 * @property {string} [arch]
 */

/**
 * @param {object} rawProfile
 * @param {Capabilities} [capabilities]
 * @param {Hardware} [hardware]
 * @param {object} [policy]
 */
export function compile(rawProfile, capabilities = {}, hardware = {}, policy = {}) {
    const rawUnknownKeys = rawProfile && typeof rawProfile === 'object' && !Array.isArray(rawProfile)
        ? Object.keys(rawProfile).filter((k) => !KNOWN_RAW_KEYS.has(k))
        : [];

    let profile;
    try {
        profile = migrateToV1(rawProfile);
    } catch (e) {
        return blockedResult(rawProfile, e.message || String(e));
    }

    const validation = validateMiningProfile(profile);
    if (!validation.ok) {
        return blockedResult(profile, validation.errors.join('; '));
    }

    const warnings = [];
    const unsupported = [];
    const restartRequired = [];
    const sources = {};
    const locks = new Set(profile.locks?.fields || []);

    for (const k of rawUnknownKeys) {
        warnings.push({
            field: k,
            code: 'unknown_key',
            message: `unknown key "${k}" ignored (not silently applied)`
        });
    }

    // --- safety: coin / engine ---
    const coinGate = capabilities.coins?.[profile.coin];
    if (coinGate && coinGate.status && coinGate.status !== 'supported') {
        return blockedResult(
            profile,
            coinGate.reason || `${profile.coin} unavailable on this engine`,
            { warnings, unsupported, sources }
        );
    }

    if (profile.engine === 'randomx-js' && profile.coin !== 'monero') {
        return blockedResult(
            profile,
            'randomx-js only verifies Monero RandomX (rx/0)',
            { warnings, unsupported, sources }
        );
    }

    if (profile.engine === 'xmrig' && profile.coin === 'dero') {
        return blockedResult(
            profile,
            'DERO requires dero-miner / daemon adapter, not XMRig Stratum (#27)',
            { warnings, unsupported, sources }
        );
    }

    // MoneroOcean payout asset rule (#29)
    const urlLower = String(profile.endpoint.url || '').toLowerCase();
    const poolIdLower = String(profile.endpoint.poolId || '').toLowerCase();
    const isMoneroOcean = urlLower.includes('moneroocean') || poolIdLower.includes('moneroocean');
    if (isMoneroOcean && profile.payoutAsset !== 'XMR') {
        return blockedResult(
            profile,
            'MoneroOcean pays XMR only; refuse non-XMR payout asset (#29)',
            { warnings, unsupported, sources }
        );
    }

    // --- endpoint / TLS ---
    let tls = profile.endpoint.tls;
    setSource(sources, 'endpoint.tls', tls, locks.has('endpoint.tls') ? 'user-lock' : 'requested');

    if (tls === true && capabilities.tls === false) {
        if (locks.has('endpoint.tls')) {
            return blockedResult(
                profile,
                'TLS requested and locked but runtime has no TLS support',
                { warnings, unsupported, sources }
            );
        }
        tls = false;
        setSource(sources, 'endpoint.tls', false, 'safety');
        warnings.push({
            field: 'endpoint.tls',
            code: 'tls_unavailable',
            message: 'Runtime lacks TLS; falling back to plaintext after capability check'
        });
        restartRequired.push('endpoint.tls');
    }
    if (tls == null) {
        tls = false;
        setSource(sources, 'endpoint.tls', false, 'conservative-fallback');
    }

    // --- CPU ---
    const logical = Math.max(1, Number(hardware.logicalCpus) || 1);
    let cpuMode = profile.cpu.mode;
    let threads = profile.cpu.threads;
    let hint = profile.cpu.maxThreadsHintPercent;

    if (locks.has('cpu.mode')) {
        setSource(sources, 'cpu.mode', cpuMode, 'user-lock');
    } else if (capabilities.acceptedTune?.cpu?.mode) {
        cpuMode = capabilities.acceptedTune.cpu.mode;
        setSource(sources, 'cpu.mode', cpuMode, 'accepted-tune');
    } else {
        setSource(sources, 'cpu.mode', cpuMode, 'requested');
    }

    if (cpuMode === 'manual') {
        if (threads == null || threads < 1) {
            threads = conservativeThreads(logical);
            setSource(sources, 'cpu.threads', threads, 'conservative-fallback');
            warnings.push({
                field: 'cpu.threads',
                code: 'threads_fallback',
                message: `manual mode missing threads; using conservative ${threads}`
            });
        } else {
            const capped = Math.min(threads, logical);
            if (capped !== threads) {
                warnings.push({
                    field: 'cpu.threads',
                    code: 'threads_capped',
                    message: `threads ${threads} capped to logical CPU count ${logical}`
                });
                threads = capped;
                setSource(sources, 'cpu.threads', threads, 'safety');
            } else {
                setSource(
                    sources,
                    'cpu.threads',
                    threads,
                    locks.has('cpu.threads') ? 'user-lock' : 'requested'
                );
            }
        }
        hint = null;
        setSource(sources, 'cpu.maxThreadsHintPercent', null, 'derived');
    } else {
        threads = null;
        setSource(sources, 'cpu.threads', null, 'derived');
        if (hint == null) {
            hint = capabilities.acceptedTune?.cpu?.maxThreadsHintPercent
                ?? capabilities.presets?.maxThreadsHintPercent
                ?? 75;
            setSource(
                sources,
                'cpu.maxThreadsHintPercent',
                hint,
                capabilities.acceptedTune?.cpu?.maxThreadsHintPercent
                    ? 'accepted-tune'
                    : capabilities.presets?.maxThreadsHintPercent
                        ? 'verified-preset'
                        : 'conservative-fallback'
            );
        } else {
            setSource(
                sources,
                'cpu.maxThreadsHintPercent',
                hint,
                locks.has('cpu.maxThreadsHintPercent') ? 'user-lock' : 'requested'
            );
        }
    }

    // Affinity: unsupported unless hardware says so
    let affinity = profile.cpu.affinity;
    if (affinity && policy.allowAffinity !== true) {
        unsupported.push({
            field: 'cpu.affinity',
            reason: 'affinity not enabled for this platform/policy'
        });
        if (!locks.has('cpu.affinity')) {
            affinity = null;
            setSource(sources, 'cpu.affinity', null, 'safety');
        } else {
            setSource(sources, 'cpu.affinity', affinity, 'user-lock');
            warnings.push({
                field: 'cpu.affinity',
                code: 'affinity_locked_unsupported',
                message: 'affinity locked but may be ignored by backend'
            });
        }
    } else {
        setSource(sources, 'cpu.affinity', affinity ?? null, affinity ? 'requested' : 'derived');
    }

    const requestedRx = profile.randomx?.mode
        || (profile.coin === 'wownero' ? 'light' : 'auto');
    let randomxMode = requestedRx;
    const memMb = hardware.availableMemoryMb;
    const availableBytes = Number.isFinite(memMb) ? Math.floor(memMb * 1024 * 1024) : null;
    // Conservative compile-time gate (#35): unknown or <2 GiB → light unless locked.
    if (!locks.has('randomx.mode')) {
        if (availableBytes == null) {
            if (requestedRx === 'auto' || requestedRx === 'fast') {
                randomxMode = 'light';
                setSource(sources, 'randomx.mode', randomxMode, 'memory-unknown-fallback');
                warnings.push({
                    field: 'randomx.mode',
                    code: 'memory_unknown',
                    message: 'available RAM unknown — resolved light until probe (#35)'
                });
            }
        } else if (availableBytes < 2 * 1024 * 1024 * 1024 && (requestedRx === 'auto' || requestedRx === 'fast')) {
            randomxMode = 'light';
            setSource(sources, 'randomx.mode', randomxMode, 'memory-budget');
            warnings.push({
                field: 'randomx.mode',
                code: 'low_ram',
                message: 'available RAM < 2 GiB — RandomX light (#35)'
            });
        } else {
            setSource(sources, 'randomx.mode', randomxMode, profile.randomx?.mode ? 'requested' : 'conservative-fallback');
        }
    } else {
        setSource(sources, 'randomx.mode', randomxMode, 'user-lock');
    }
    if (!sources['randomx.mode']) {
        setSource(sources, 'randomx.mode', randomxMode, profile.randomx?.mode ? 'requested' : 'conservative-fallback');
    }

    const donateLevel = profile.donateLevel ?? 1;
    setSource(sources, 'donateLevel', donateLevel, 'requested');

    const resolved = {
        schemaVersion: 1,
        id: profile.id,
        name: profile.name || 'Default',
        engine: profile.engine,
        coin: profile.coin,
        payoutAsset: profile.payoutAsset,
        endpoint: {
            type: profile.endpoint.type,
            url: profile.endpoint.url.trim(),
            tls,
            poolId: profile.endpoint.poolId ?? null
        },
        account: {
            user: profile.account.user,
            pass: profile.account.pass ?? 'x',
            rigId: profile.account.rigId ?? null
        },
        cpu: {
            mode: cpuMode,
            threads,
            maxThreadsHintPercent: hint,
            affinity
        },
        randomx: { mode: randomxMode },
        network: {
            autoReconnect: profile.network?.autoReconnect ?? true,
            retries: profile.network?.retries ?? 5,
            retryPauseSec: profile.network?.retryPauseSec ?? 5
        },
        power: profile.power || {},
        thermal: profile.thermal || {},
        locks: { fields: [...locks] },
        donateLevel
    };

    const native = buildNative(resolved, hardware);
    const revision = checksum({ profile, resolved, native, capabilities: summarizeCaps(capabilities) });

    // Effective snapshot: only values we can assert pre-launch; rest unknown
    const effective = {
        revision,
        fields: {
            'endpoint.url': known(resolved.endpoint.url, sources['endpoint.url'] || 'requested'),
            'endpoint.tls': known(resolved.endpoint.tls, sources['endpoint.tls']),
            'cpu.mode': known(resolved.cpu.mode, sources['cpu.mode']),
            'cpu.threads': resolved.cpu.mode === 'manual'
                ? known(resolved.cpu.threads, sources['cpu.threads'])
                : unknown('not applied until engine autoconfig'),
            'cpu.maxThreadsHintPercent': resolved.cpu.mode === 'auto'
                ? known(resolved.cpu.maxThreadsHintPercent, sources['cpu.maxThreadsHintPercent'])
                : unknown('hint unused in manual mode'),
            'randomx.mode': known(resolved.randomx.mode, sources['randomx.mode']),
            'donateLevel': known(resolved.donateLevel, sources.donateLevel),
            // Post-launch readbacks stay unknown until session reports them
            'runtime.threads': unknown('awaiting engine readback'),
            'runtime.randomxMode': unknown('awaiting engine readback'),
            'runtime.hugePages': unknown('awaiting engine readback'),
            'runtime.tls': unknown('awaiting engine readback')
        }
    };

    return {
        ok: true,
        blocked: false,
        revision,
        requested: profile,
        resolved,
        effective,
        native,
        warnings,
        unsupported,
        restartRequired,
        sources
    };
}

function buildNative(resolved, hardware) {
    const solo = resolved.endpoint.type === 'daemon';
    const pool = {
        url: resolved.endpoint.url,
        user: resolved.account.user,
        pass: solo ? 'x' : (resolved.account.pass || 'x'),
        keepalive: !solo,
        tls: solo ? false : !!resolved.endpoint.tls
    };
    if (solo) {
        pool.daemon = true;
        pool.coin = 'monero';
    } else if (resolved.coin === 'wownero') {
        pool.coin = 'wownero';
    } else if (resolved.coin === 'dero') {
        pool.coin = 'dero';
        pool.algo = 'astrobwt/v3';
    }

    const cpu = { enabled: true, priority: 1, asm: true, 'argon2-impl': 'auto' };
    if (resolved.cpu.mode === 'auto' && resolved.cpu.maxThreadsHintPercent != null) {
        cpu['max-threads-hint'] = resolved.cpu.maxThreadsHintPercent;
    }

    const json = {
        autosave: false,
        cpu,
        pools: [pool],
        'donate-level': resolved.donateLevel,
        'print-time': 10,
        retries: resolved.network.retries,
        'retry-pause': resolved.network.retryPauseSec,
        randomx: {
            mode: resolved.randomx.mode,
            '1gb-pages': false,
            rdmsr: false,
            wrmsr: false
        }
    };

    // Argv: never shell-concatenate; structured list only
    const argv = ['xmrig', '-c', '<config.json>'];
    if (resolved.cpu.mode === 'manual' && resolved.cpu.threads != null) {
        argv.push('-t', String(resolved.cpu.threads));
    }
    argv.push('--no-color');

    return {
        format: 'xmrig-json+argv',
        json,
        argv,
        hardwareNote: {
            logicalCpus: hardware.logicalCpus ?? null
        }
    };
}

function conservativeThreads(logical) {
    return Math.max(1, Math.min(logical, logical - 1 || 1));
}

function setSource(sources, field, value, source) {
    sources[field] = source;
}

function known(value, source) {
    return { value, source, confidence: 'known' };
}

function unknown(reason) {
    return { value: null, source: 'unknown', confidence: 'unknown', reason };
}

function checksum(obj) {
    return createHash('sha256').update(stableStringify(obj)).digest('hex').slice(0, 16);
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

function summarizeCaps(capabilities) {
    return {
        platform: capabilities.platform ?? null,
        backend: capabilities.backend ?? null,
        tls: capabilities.tls ?? null,
        coins: capabilities.coins ?? null
    };
}

function blockedResult(profile, reason, extra = {}) {
    return {
        ok: false,
        blocked: { reason },
        revision: null,
        requested: profile,
        resolved: null,
        effective: null,
        native: null,
        warnings: extra.warnings || [],
        unsupported: extra.unsupported || [],
        restartRequired: [],
        sources: extra.sources || {}
    };
}
