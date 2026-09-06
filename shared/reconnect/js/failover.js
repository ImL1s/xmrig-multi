/**
 * Compatible backup / failover selection (#43).
 * Never changes payout wallet, coin, or downgrades TLS without explicit allow.
 */

/**
 * @typedef {object} Endpoint
 * @property {string} id
 * @property {string} url
 * @property {string} [payoutAsset]
 * @property {string} [accountUser]
 * @property {boolean} [tls]
 * @property {string} [protocol] stratum|daemon|web-proxy
 * @property {boolean} [enabled]
 * @property {boolean} [userApproved]
 * @property {boolean} [allowTlsDowngrade]
 */

/**
 * @param {Endpoint} primary
 * @param {Endpoint[]} backups ordered preference
 * @param {object} [ctx]
 * @param {string} [ctx.failedId] currently failing endpoint id
 * @param {Set<string>|string[]} [ctx.cooldownIds] recently failed; skip until cooled
 * @param {number} [ctx.now]
 * @returns {{ ok: boolean, endpoint: Endpoint|null, reason: string }}
 */
export function selectFailoverTarget(primary, backups = [], ctx = {}) {
    if (!primary || !primary.url) {
        return { ok: false, endpoint: null, reason: 'no primary endpoint' };
    }
    const cooldown = ctx.cooldownIds instanceof Set
        ? ctx.cooldownIds
        : new Set(ctx.cooldownIds || []);

    const candidates = [];
    // After primary failure, try backups first; primary may return later via return-to-primary.
    for (const b of backups) {
        if (!b) continue;
        candidates.push(b);
    }
    candidates.push(primary);

    for (const ep of candidates) {
        if (ctx.failedId && ep.id === ctx.failedId) continue;
        if (cooldown.has(ep.id)) continue;
        const gate = isCompatibleBackup(primary, ep);
        if (!gate.ok) continue;
        if (ep.enabled === false) continue;
        if (ep.userApproved === false) continue;
        // Backups must be explicitly approved; primary is always approved.
        if (ep.id !== primary.id && ep.userApproved !== true) continue;
        return { ok: true, endpoint: ep, reason: gate.reason || 'compatible' };
    }
    return { ok: false, endpoint: null, reason: 'no compatible backup available' };
}

/**
 * @param {Endpoint} primary
 * @param {Endpoint} candidate
 */
export function isCompatibleBackup(primary, candidate) {
    if (!candidate?.url) {
        return { ok: false, reason: 'missing url' };
    }
    if (primary.payoutAsset && candidate.payoutAsset
        && primary.payoutAsset !== candidate.payoutAsset) {
        return { ok: false, reason: 'payout asset mismatch' };
    }
    if (primary.accountUser && candidate.accountUser
        && primary.accountUser !== candidate.accountUser) {
        return { ok: false, reason: 'account/wallet mismatch — refusing silent wallet change' };
    }
    const pProto = primary.protocol || 'stratum';
    const cProto = candidate.protocol || 'stratum';
    if (pProto !== cProto) {
        return { ok: false, reason: 'protocol mismatch' };
    }
    const pTls = !!primary.tls;
    const cTls = candidate.tls == null ? pTls : !!candidate.tls;
    if (pTls && !cTls && !candidate.allowTlsDowngrade) {
        return { ok: false, reason: 'TLS downgrade refused' };
    }
    return { ok: true, reason: 'compatible' };
}

/**
 * Whether it is time to prefer primary again after a successful backup stretch.
 * @param {object} opts
 * @param {number} opts.lastPrimaryFailAt
 * @param {number} opts.now
 * @param {number} [opts.returnAfterMs] default 5 min
 */
export function shouldReturnToPrimary(opts) {
    const after = opts.returnAfterMs ?? 5 * 60_000;
    if (!opts.lastPrimaryFailAt) return true;
    return (opts.now - opts.lastPrimaryFailAt) >= after;
}
