/**
 * Backup endpoint compatibility gate (#43).
 * Never switch wallet / payout coin / unauthorized TLS downgrade.
 */

/**
 * @param {object} active current endpoint + account
 * @param {object} candidate backup endpoint
 * @param {{ allowTlsDowngrade?: boolean }} [opts]
 */
export function canFailoverTo(active = {}, candidate = {}, opts = {}) {
    const reasons = [];
    if (candidate.enabled === false) {
        return { ok: false, reasons: ['backup disabled'] };
    }
    if (!candidate.url) {
        return { ok: false, reasons: ['backup missing url'] };
    }

    const activeCoin = (active.payoutCoin || active.coin || '').toLowerCase();
    const candCoin = (candidate.payoutCoin || candidate.coin || activeCoin).toLowerCase();
    if (activeCoin && candCoin && activeCoin !== candCoin) {
        reasons.push('payout coin mismatch — refusing failover');
    }

    const activeWallet = active.wallet || active.user || '';
    const candWallet = candidate.wallet || candidate.user || activeWallet;
    if (activeWallet && candWallet && activeWallet !== candWallet) {
        reasons.push('wallet mismatch — refusing failover');
    }

    const activeTls = !!active.tls;
    const candTls = candidate.tls == null ? activeTls : !!candidate.tls;
    if (activeTls && !candTls && !opts.allowTlsDowngrade) {
        reasons.push('TLS downgrade not approved');
    }

    const activeProto = (active.protocol || 'stratum').toLowerCase();
    const candProto = (candidate.protocol || activeProto).toLowerCase();
    if (activeProto !== candProto) {
        reasons.push(`protocol mismatch (${activeProto}→${candProto})`);
    }

    return {
        ok: reasons.length === 0,
        reasons,
        endpoint: candidate
    };
}

/**
 * Pick next compatible backup in order, respecting cooldown.
 * @param {object} active
 * @param {object[]} backups
 * @param {{ now?: number, cooldownUntil?: Record<string, number>, allowTlsDowngrade?: boolean }} [opts]
 */
export function nextFailover(active, backups = [], opts = {}) {
    const now = opts.now ?? Date.now();
    const cooldown = opts.cooldownUntil || {};
    for (const backup of backups) {
        const id = backup.id || backup.url;
        if (cooldown[id] && cooldown[id] > now) continue;
        const gate = canFailoverTo(active, backup, opts);
        if (gate.ok) return { ok: true, backup, reasons: [] };
    }
    return { ok: false, backup: null, reasons: ['all backups incompatible or in cooldown'] };
}
