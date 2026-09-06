/**
 * Classify mining disconnect / failure reasons (#43).
 */

/** @typedef {'retryable'|'fatal'|'pause'} DisconnectClass */

/**
 * @param {object} input
 * @param {string} [input.code]
 * @param {string} [input.message]
 * @param {string} [input.reason]
 * @returns {{ kind: DisconnectClass, code: string, retryable: boolean, label: string }}
 */
export function classifyDisconnect(input = {}) {
    const raw = `${input.code || ''} ${input.message || ''} ${input.reason || ''}`.toLowerCase();
    const code = (input.code || inferCode(raw) || 'unknown').toLowerCase();

    if (isUserOrPolicy(code, raw)) {
        return { kind: 'fatal', code, retryable: false, label: labelFor(code, 'stopped by user or policy') };
    }
    if (isAuthOrConfig(code, raw)) {
        return { kind: 'fatal', code, retryable: false, label: labelFor(code, 'credentials or protocol rejected') };
    }
    if (isTlsFatal(code, raw)) {
        return { kind: 'fatal', code, retryable: false, label: labelFor(code, 'TLS certificate rejected') };
    }
    if (isPause(code, raw)) {
        return { kind: 'pause', code, retryable: false, label: labelFor(code, 'policy pause — no auto restart') };
    }
    // transient network / proxy
    if (isTransient(code, raw)) {
        return { kind: 'retryable', code, retryable: true, label: labelFor(code, 'transient disconnect') };
    }
    // unknown → retryable once classified as soft close, else fatal
    if (raw.includes('close') || raw.includes('disconnect') || raw.includes('timeout') || code === 'unknown') {
        return { kind: 'retryable', code: code === 'unknown' ? 'network' : code, retryable: true, label: 'transient disconnect' };
    }
    return { kind: 'fatal', code, retryable: false, label: labelFor(code, 'non-retryable failure') };
}

function inferCode(raw) {
    if (raw.includes('auth') || raw.includes('login') || raw.includes('unauthorized')) return 'auth_fail';
    if (raw.includes('wallet') || raw.includes('address')) return 'bad_wallet';
    if (raw.includes('tls') || raw.includes('certificate') || raw.includes('cert')) return 'tls_cert';
    if (raw.includes('dns') || raw.includes('enotfound') || raw.includes('getaddrinfo')) return 'dns';
    if (raw.includes('timeout') || raw.includes('etimedout')) return 'timeout';
    if (raw.includes('econnrefused') || raw.includes('refused')) return 'conn_refused';
    if (raw.includes('network') || raw.includes('offline') || raw.includes('unreachable')) return 'network';
    if (raw.includes('thermal') || raw.includes('temperature')) return 'thermal';
    if (raw.includes('battery')) return 'battery';
    if (raw.includes('user') && raw.includes('stop')) return 'user_stop';
    if (raw.includes('profile')) return 'profile_change';
    if (raw.includes('unsupported') || raw.includes('protocol')) return 'unsupported_protocol';
    return null;
}

function isUserOrPolicy(code, raw) {
    return ['user_stop', 'profile_change', 'cancelled', 'cancel'].includes(code)
        || raw.includes('user-stop')
        || raw.includes('manual stop')
        || raw.includes('profile change')
        || raw.includes('profile revision');
}

function isAuthOrConfig(code, raw) {
    return ['auth_fail', 'bad_wallet', 'unsupported_protocol', 'login_fail'].includes(code)
        || raw.includes('invalid wallet')
        || raw.includes('login error')
        || raw.includes('unauthorized')
        || raw.includes('unsupported protocol');
}

function isTlsFatal(code, raw) {
    return code === 'tls_cert'
        || raw.includes('certificate')
        || raw.includes('cert verify')
        || raw.includes('ssl handshake');
}

function isPause(code, raw) {
    return ['thermal', 'battery', 'policy_pause'].includes(code)
        || raw.includes('thermal critical')
        || raw.includes('battery too low');
}

function isTransient(code, raw) {
    return ['timeout', 'dns', 'network', 'conn_refused', 'proxy_close', 'eof', 'reset'].includes(code)
        || raw.includes('temporarily')
        || raw.includes('wifi')
        || raw.includes('cellular')
        || raw.includes('connection reset')
        || raw.includes('econnreset');
}

function labelFor(code, fallback) {
    const map = {
        timeout: 'connection timed out',
        dns: 'DNS lookup failed',
        network: 'network unavailable',
        conn_refused: 'connection refused',
        proxy_close: 'proxy closed',
        auth_fail: 'pool authentication failed',
        bad_wallet: 'wallet rejected',
        tls_cert: 'TLS certificate rejected',
        unsupported_protocol: 'unsupported protocol',
        user_stop: 'manual stop',
        profile_change: 'profile changed',
        thermal: 'thermal critical',
        battery: 'battery policy'
    };
    return map[code] || fallback;
}
