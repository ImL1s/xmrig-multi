/**
 * Classify connectivity failures for reconnect policy (#43).
 */

/** @typedef {'retryable'|'fatal'|'policy_stop'|'user_stop'} FailureClass */

/**
 * @param {object} err
 * @param {string} [err.code]
 * @param {string} [err.message]
 * @param {number} [err.httpStatus]
 * @param {string} [err.kind]
 * @returns {{ class: FailureClass, reason: string, retryable: boolean }}
 */
export function classifyFailure(err = {}) {
    const kind = String(err.kind || '').toLowerCase();
    const code = String(err.code || '').toLowerCase();
    const msg = String(err.message || '').toLowerCase();

    if (kind === 'user_stop' || code === 'user_stop') {
        return { class: 'user_stop', reason: 'user stopped mining', retryable: false };
    }
    if (kind === 'policy_stop' || kind === 'thermal_critical' || kind === 'profile_change') {
        return { class: 'policy_stop', reason: kind || 'policy stop', retryable: false };
    }

    // Auth / wallet / protocol — do not retry
    if (
        /auth|login|invalid.?user|bad.?wallet|unauth|forbidden|unsupported.?algo|unsupported.?protocol/.test(
            msg
        ) ||
        ['auth_fail', 'bad_wallet', 'unsupported_protocol'].includes(code) ||
        err.httpStatus === 401 ||
        err.httpStatus === 403
    ) {
        return { class: 'fatal', reason: 'authentication or protocol rejected', retryable: false };
    }

    // TLS certificate — fatal unless user overrides elsewhere
    if (/cert|certificate|tls|ssl|hostname/.test(msg) || code === 'tls_cert') {
        return { class: 'fatal', reason: 'TLS certificate error', retryable: false };
    }

    // Transient network
    if (
        /timeout|timed.?out|econnreset|econnrefused|enotfound|dns|network|offline|socket|disconnect|close/.test(
            msg
        ) ||
        ['timeout', 'dns', 'econnreset', 'econnrefused', 'enotfound', 'network_change', 'ws_close'].includes(
            code
        ) ||
        kind === 'disconnect' ||
        kind === 'network_change'
    ) {
        return { class: 'retryable', reason: code || kind || 'transient disconnect', retryable: true };
    }

    // Default: treat unknown close as retryable once classified soft
    if (kind === 'close' || code === 'ws_close' || err.code === 1006) {
        return { class: 'retryable', reason: 'connection closed', retryable: true };
    }

    return { class: 'fatal', reason: msg || code || 'unknown failure', retryable: false };
}
