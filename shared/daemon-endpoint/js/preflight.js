/**
 * Solo daemon preflight (#44) — TCP is not enough.
 */

import { parseDaemonEndpoint } from './parse.js';

/**
 * @param {string} rawUrl
 * @param {object} [opts]
 * @param {boolean} [opts.allowHttps]
 * @param {(host: string, port: number) => Promise<{ok:boolean,code?:string,error?:string}>} [opts.tcpConnect]
 * @param {(req: object) => Promise<object>} [opts.rpcCall] JSON-RPC transport
 * @param {number} [opts.expectedNetwork] Monero mainnet=0 etc; null skips
 * @returns {Promise<object>}
 */
export async function preflightDaemon(rawUrl, opts = {}) {
    const parsed = parseDaemonEndpoint(rawUrl, { allowHttps: opts.allowHttps });
    if (!parsed.ok) {
        return {
            ok: false,
            stage: 'parse',
            code: parsed.code,
            error: parsed.error,
            hint: repairHint(parsed.code),
            parsed
        };
    }

    const tcp = opts.tcpConnect
        ? await opts.tcpConnect(parsed.host, parsed.port)
        : { ok: true };
    if (!tcp.ok) {
        return {
            ok: false,
            stage: 'tcp',
            code: tcp.code || 'tcp_fail',
            error: tcp.error || 'TCP connect failed',
            hint: parsed.isLoopback
                ? '127.0.0.1 on a phone is the phone itself — run monerod on-device or use a LAN IP'
                : 'Check host/port, firewall, and that monerod is listening',
            parsed
        };
    }

    if (!opts.rpcCall) {
        return {
            ok: false,
            stage: 'rpc',
            code: 'rpc_required',
            error: 'TCP reachable is not proof the node can mine — RPC probe required',
            hint: 'Provide JSON-RPC get_info / hard_fork_info probe before start',
            parsed,
            tcpOnly: true
        };
    }

    let info;
    try {
        info = await opts.rpcCall({
            jsonrpc: '2.0',
            id: 'preflight',
            method: 'get_info',
            params: {}
        });
    } catch (e) {
        return {
            ok: false,
            stage: 'rpc',
            code: 'rpc_transport',
            error: e.message || String(e),
            hint: 'Node accepted TCP but JSON-RPC failed — wrong service or auth?',
            parsed
        };
    }

    if (info?.error) {
        const msg = info.error.message || JSON.stringify(info.error);
        const restricted = /restricted|forbidden|unauthorized|auth/i.test(msg);
        return {
            ok: false,
            stage: 'rpc',
            code: restricted ? 'rpc_restricted' : 'rpc_error',
            error: msg,
            hint: restricted
                ? 'RPC rejected the call — enable mining methods or use unrestricted credentials (never expose publicly)'
                : 'JSON-RPC error from daemon',
            parsed
        };
    }

    const result = info?.result || info;
    if (!result || typeof result !== 'object') {
        return {
            ok: false,
            stage: 'rpc',
            code: 'not_monerod',
            error: 'response missing get_info result',
            hint: 'Endpoint does not look like monerod JSON-RPC',
            parsed
        };
    }

    if (result.synchronized === false) {
        return {
            ok: false,
            stage: 'sync',
            code: 'syncing',
            error: 'daemon is still synchronizing',
            hint: 'Wait until monerod finishes sync before solo mining',
            parsed,
            info: summarize(result)
        };
    }

    if (opts.expectedNetwork != null && result.nettype) {
        const map = { mainnet: 0, testnet: 1, stagenet: 2 };
        const got = map[String(result.nettype).toLowerCase()];
        if (got != null && got !== opts.expectedNetwork) {
            return {
                ok: false,
                stage: 'network',
                code: 'wrong_network',
                error: `daemon nettype=${result.nettype}, expected ${opts.expectedNetwork}`,
                hint: 'Wallet network and daemon network must match',
                parsed,
                info: summarize(result)
            };
        }
    }

    // busy_syncing flag used by some builds
    if (result.busy_syncing === true) {
        return {
            ok: false,
            stage: 'sync',
            code: 'syncing',
            error: 'daemon busy_syncing',
            hint: 'Wait until monerod finishes sync before solo mining',
            parsed,
            info: summarize(result)
        };
    }

    return {
        ok: true,
        stage: 'ready',
        code: 'ok',
        parsed,
        info: summarize(result),
        warning: parsed.warning
    };
}

function summarize(result) {
    return {
        height: result.height,
        targetHeight: result.target_height,
        synchronized: result.synchronized,
        nettype: result.nettype,
        version: result.version,
        offline: result.offline
    };
}

function repairHint(code) {
    const map = {
        empty: 'Enter monerod RPC as host:port or http://host:port',
        bad_scheme: 'Use http:// or https://, or bare host:port',
        bad_host: 'Check hostname — http://host:port was mis-parsed historically as host "http"',
        bad_port: 'Port must be 1–65535; omit port to default to 18081',
        bad_ipv6: 'Use [2001:db8::1]:18081 form for IPv6 with port',
        tls_unsupported: 'This build cannot use https daemons'
    };
    return map[code] || 'Fix the daemon URL and retry';
}
