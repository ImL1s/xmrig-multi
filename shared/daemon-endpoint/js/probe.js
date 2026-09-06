'use strict';

/**
 * Staged daemon readiness — TCP success ≠ ready to mine (#44).
 *
 * Stages (in order): parse → dns → tcp → tls → rpc_version → network → sync → mining_auth
 */

const STAGES = Object.freeze([
    'parse',
    'dns',
    'tcp',
    'tls',
    'rpc_version',
    'network',
    'sync',
    'mining_auth'
]);

/**
 * Evaluate a mock/fixture get_info (or error) payload into a readiness result.
 * Used by contract tests; Android/Desktop implement the real HTTP transport.
 *
 * @param {object} fixture
 * @param {{ expectMainnet?: boolean, requireUnrestricted?: boolean }} [opts]
 */
function evaluateDaemonFixture(fixture, opts = {}) {
    const expectMainnet = opts.expectMainnet !== false;
    const requireUnrestricted = opts.requireUnrestricted !== false;
    const checkedAt = fixture.checkedAt || new Date().toISOString();

    if (fixture.error === 'dns') {
        return result(false, 'dns', 'dns_failed', 'Could not resolve daemon hostname', checkedAt);
    }
    if (fixture.error === 'tcp') {
        return result(false, 'tcp', 'tcp_failed', 'TCP connect to daemon failed', checkedAt);
    }
    if (fixture.error === 'tls') {
        return result(false, 'tls', 'tls_failed', 'TLS handshake with daemon failed', checkedAt);
    }
    if (fixture.error === 'http_non_json') {
        return result(false, 'rpc_version', 'not_rpc', 'Endpoint is not a monerod JSON-RPC service', checkedAt);
    }
    if (fixture.error === 'auth_denied' || fixture.httpStatus === 401) {
        return result(false, 'mining_auth', 'auth_denied', 'Daemon RPC authentication denied', checkedAt, {
            remediation: 'Check RPC login credentials; do not log the password'
        });
    }
    if (fixture.error === 'restricted' || fixture.restricted === true) {
        return result(false, 'mining_auth', 'restricted_rpc', 'Restricted RPC cannot submit blocks for solo mining', checkedAt, {
            remediation: 'Use an unrestricted RPC bind for trusted LAN only — never expose publicly'
        });
    }

    const info = fixture.result || fixture;
    if (!info || typeof info !== 'object') {
        return result(false, 'rpc_version', 'bad_json', 'Daemon returned unexpected JSON', checkedAt);
    }
    if (info.version == null && info.rpc_version == null && info.height == null) {
        return result(false, 'rpc_version', 'not_monerod', 'Response does not look like monerod get_info', checkedAt);
    }

    // Wrong network: nettype / mainnet flag
    const nettype = (info.nettype || info.network_type || '').toLowerCase();
    if (expectMainnet) {
        if (nettype === 'testnet' || nettype === 'stagenet' || info.mainnet === false) {
            return result(false, 'network', 'wrong_network', `Daemon network is ${nettype || 'non-mainnet'}; expected mainnet`, checkedAt);
        }
    }

    const synchronized = info.synchronized === true ||
        (info.synchronized !== false && info.target_height != null && info.height != null &&
            Number(info.height) >= Number(info.target_height) && Number(info.target_height) > 0);

    if (info.synchronized === false ||
        (info.target_height != null && info.height != null && Number(info.height) + 2 < Number(info.target_height))) {
        return result(false, 'sync', 'syncing', 'Daemon is still synchronizing — wait before solo mining', checkedAt, {
            height: info.height,
            targetHeight: info.target_height
        });
    }

    if (requireUnrestricted && info.restricted === true) {
        return result(false, 'mining_auth', 'restricted_rpc', 'Restricted RPC cannot submit blocks for solo mining', checkedAt);
    }

    if (!synchronized && info.synchronized == null) {
        // Missing sync fields — treat as unknown, not ready
        return result(false, 'sync', 'sync_unknown', 'Daemon sync status unknown', checkedAt);
    }

    return result(true, 'mining_auth', 'ready', 'Daemon RPC ready to mine', checkedAt, {
        height: info.height,
        nettype: nettype || (info.mainnet === false ? 'non-mainnet' : 'mainnet')
    });
}

function result(ok, stage, code, message, checkedAt, extra = {}) {
    return {
        ok,
        stage,
        code,
        message,
        checkedAt,
        readyToMine: ok === true && code === 'ready',
        ...extra
    };
}

module.exports = {
    STAGES,
    evaluateDaemonFixture
};
