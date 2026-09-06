/**
 * Companion remote-control + sync-quality protocol (#62).
 */

/** @typedef {'live'|'stale'|'offline'} SyncQuality */
/** @typedef {'start'|'stop'|'request_stats'} CommandType */
/** @typedef {'accepted'|'rejected'|'completed'|'expired'|'undelivered'|'pending'} CommandAck */

export const DEFAULT_STALE_AFTER_MS = 45_000;
export const DEFAULT_COMMAND_TTL_MS = 60_000;

const SECRET_KEYS = new Set([
    'wallet',
    'walletAddress',
    'password',
    'pass',
    'poolPassword',
    'apiToken',
    'token',
    'privateKey',
    'seed'
]);

/**
 * Classify how the watch must render a stats snapshot.
 * @param {object} input
 * @returns {{ quality: SyncQuality, label: string, showAsLive: boolean, lastSyncAtMs: number|null, sourceDeviceId: string|null, sessionId: string|null }}
 */
export function classifySync(input = {}) {
    const nowMs = input.nowMs ?? Date.now();
    const lastSyncAtMs = numberOrNull(input.lastSyncAtMs);
    const paired = input.paired !== false;
    const reachable = Boolean(input.reachable);
    const staleAfterMs = Number(input.staleAfterMs) > 0
        ? Number(input.staleAfterMs)
        : DEFAULT_STALE_AFTER_MS;

    if (!paired || !reachable || lastSyncAtMs == null) {
        return {
            quality: 'offline',
            label: 'Offline — last numbers are not live',
            showAsLive: false,
            lastSyncAtMs,
            sourceDeviceId: input.sourceDeviceId || null,
            sessionId: input.sessionId || null
        };
    }

    const age = nowMs - lastSyncAtMs;
    if (age > staleAfterMs) {
        return {
            quality: 'stale',
            label: `Stale (${Math.floor(age / 1000)}s ago)`,
            showAsLive: false,
            lastSyncAtMs,
            sourceDeviceId: input.sourceDeviceId || null,
            sessionId: input.sessionId || null
        };
    }

    return {
        quality: 'live',
        label: 'Live',
        showAsLive: true,
        lastSyncAtMs,
        sourceDeviceId: input.sourceDeviceId || null,
        sessionId: input.sessionId || null
    };
}

/**
 * Build a remote command envelope. Never attach secrets.
 * @param {object} partial
 */
export function buildCommand(partial = {}) {
    const type = String(partial.type || '').toLowerCase();
    if (!['start', 'stop', 'request_stats'].includes(type)) {
        throw new Error(`unsupported command type: ${type}`);
    }
    const issuedAtMs = partial.issuedAtMs ?? Date.now();
    const ttl = Number(partial.ttlMs) > 0 ? Number(partial.ttlMs) : DEFAULT_COMMAND_TTL_MS;
    const cmd = {
        commandId: String(partial.commandId || `cmd-${issuedAtMs}-${Math.random().toString(36).slice(2, 8)}`),
        type,
        targetDeviceId: String(partial.targetDeviceId || ''),
        profileId: partial.profileId != null ? String(partial.profileId) : null,
        sessionId: partial.sessionId != null ? String(partial.sessionId) : null,
        issuedAtMs,
        expiresAtMs: partial.expiresAtMs ?? issuedAtMs + ttl,
        payload: redactSecrets(partial.payload || {})
    };
    if (!cmd.targetDeviceId) {
        throw new Error('targetDeviceId required');
    }
    return cmd;
}

/**
 * Phone-side receive: validate expiry / pairing / policy before acting.
 * @param {object} command
 * @param {object} ctx
 * @returns {{ ack: CommandAck, reason: string, apply: boolean }}
 */
export function receiveCommand(command = {}, ctx = {}) {
    const nowMs = ctx.nowMs ?? Date.now();
    if (!command || !command.commandId || !command.type) {
        return { ack: 'rejected', reason: 'Malformed command', apply: false };
    }
    if (ctx.paired === false) {
        return { ack: 'rejected', reason: 'Not paired / unauthorized', apply: false };
    }
    if (ctx.authenticated === false) {
        return { ack: 'rejected', reason: 'Channel not authenticated', apply: false };
    }
    if (numberOrNull(command.expiresAtMs) != null && command.expiresAtMs < nowMs) {
        return { ack: 'expired', reason: 'Command expired before delivery', apply: false };
    }
    if (ctx.reachable === false) {
        return { ack: 'undelivered', reason: 'Phone unreachable — stop not guaranteed', apply: false };
    }
    if (ctx.sessionId && command.sessionId && ctx.sessionId !== command.sessionId) {
        return { ack: 'rejected', reason: 'Session mismatch (phone restarted or new session)', apply: false };
    }
    if (command.type === 'start') {
        if (ctx.thermalBlocked) {
            return { ack: 'rejected', reason: 'Thermal policy blocked start', apply: false };
        }
        if (ctx.powerBlocked) {
            return { ack: 'rejected', reason: 'Power policy blocked start', apply: false };
        }
        if (ctx.missingConfig) {
            return { ack: 'rejected', reason: 'No saved mining profile on phone', apply: false };
        }
        if (ctx.userStopLatched) {
            return { ack: 'rejected', reason: 'Manual Stop latched — remote Start ignored', apply: false };
        }
    }
    return { ack: 'accepted', reason: 'Accepted', apply: true };
}

/**
 * Order / dedupe remote commands. Stop wins over older Start.
 * @param {object[]} commands newest-last or any order
 * @returns {{ effective: object|null, skipped: object[], reason: string }}
 */
export function applyCommandOrder(commands = []) {
    const seen = new Set();
    const ordered = [...commands]
        .filter((c) => c && c.commandId)
        .sort((a, b) => (a.issuedAtMs || 0) - (b.issuedAtMs || 0));

    /** @type {object|null} */
    let effective = null;
    const skipped = [];

    for (const cmd of ordered) {
        if (seen.has(cmd.commandId)) {
            skipped.push({ ...cmd, skipReason: 'duplicate commandId (idempotent)' });
            continue;
        }
        seen.add(cmd.commandId);

        if (!effective) {
            effective = cmd;
            continue;
        }

        // Newer Stop always replaces older Start (and any older command).
        if (cmd.type === 'stop' && cmd.issuedAtMs >= (effective.issuedAtMs || 0)) {
            if (effective.type === 'start') {
                skipped.push({ ...effective, skipReason: 'superseded by newer Stop' });
            } else {
                skipped.push({ ...effective, skipReason: 'superseded by newer command' });
            }
            effective = cmd;
            continue;
        }

        // Older Start must not override a newer Stop.
        if (
            effective.type === 'stop' &&
            cmd.type === 'start' &&
            (cmd.issuedAtMs || 0) <= (effective.issuedAtMs || 0)
        ) {
            skipped.push({ ...cmd, skipReason: 'older Start cannot override newer Stop' });
            continue;
        }

        if ((cmd.issuedAtMs || 0) >= (effective.issuedAtMs || 0)) {
            skipped.push({ ...effective, skipReason: 'superseded by newer command' });
            effective = cmd;
        } else {
            skipped.push({ ...cmd, skipReason: 'older than effective command' });
        }
    }

    return {
        effective,
        skipped,
        reason: effective
            ? `Effective ${effective.type} (${effective.commandId})`
            : 'No commands'
    };
}

/**
 * Strip secrets from any outbound companion payload.
 */
export function redactSecrets(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (SECRET_KEYS.has(k) || /password|token|wallet|secret|seed/i.test(k)) {
            continue;
        }
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            out[k] = redactSecrets(v);
        } else {
            out[k] = v;
        }
    }
    return out;
}

/**
 * Build a stats snapshot safe for the watch / tile.
 */
export function buildStatsSnapshot(input = {}) {
    const sync = classifySync(input);
    const running = Boolean(input.isRunning);
    return {
        sourceDeviceId: input.sourceDeviceId || null,
        sessionId: input.sessionId || null,
        lastSyncAtMs: sync.lastSyncAtMs,
        syncQuality: sync.quality,
        syncLabel: sync.label,
        showAsLive: sync.showAsLive,
        isRunning: sync.showAsLive ? running : false,
        // When not live, still expose last known numbers but UI must use syncLabel.
        lastHashrate: numberOrNull(input.hashrate),
        lastSharesAccepted: numberOrNull(input.sharesAccepted),
        lastSharesRejected: numberOrNull(input.sharesRejected),
        coinType: input.coinType || null,
        poolName: input.poolName || null,
        // Never include wallet / password
        secretsPresent: false
    };
}

function numberOrNull(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
