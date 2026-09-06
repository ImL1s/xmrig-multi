'use strict';

const DEFAULT_PORT = 18081;
const ALLOWED_SCHEMES = new Set(['http']);

/**
 * @typedef {object} DaemonEndpoint
 * @property {string} host
 * @property {number} port
 * @property {string} scheme  http only when supported
 * @property {string} path
 * @property {string} engineUrl  host:port or [ipv6]:port — never includes userinfo
 * @property {boolean} isLoopback
 * @property {boolean} hasUserinfo
 */

/**
 * @typedef {object} ParseOk
 * @property {true} ok
 * @property {DaemonEndpoint} endpoint
 */

/**
 * @typedef {object} ParseErr
 * @property {false} ok
 * @property {string} code
 * @property {string} message
 */

/**
 * Parse a solo monerod endpoint. Never silently remaps to another host/port.
 * @param {string|null|undefined} raw
 * @param {{ allowHttps?: boolean }} [opts]
 * @returns {ParseOk|ParseErr}
 */
function parseDaemonEndpoint(raw, opts = {}) {
    const allowHttps = opts.allowHttps === true;
    if (raw == null || String(raw).trim() === '') {
        return fail('empty', 'Daemon RPC URL is required');
    }
    const input = String(raw).trim();
    if (/\s/.test(input)) {
        return fail('whitespace', 'Daemon URL must not contain whitespace');
    }

    let scheme = null;
    let rest = input;
    const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(input);
    if (schemeMatch) {
        scheme = schemeMatch[1].toLowerCase();
        rest = input.slice(schemeMatch[0].length);
        if (scheme === 'https' && !allowHttps) {
            return fail('https_unsupported', 'HTTPS daemon RPC is not supported in this build; use http:// or host:port');
        }
        if (scheme !== 'http' && !(scheme === 'https' && allowHttps)) {
            return fail('scheme', `Unsupported daemon URI scheme: ${scheme}`);
        }
        if (!ALLOWED_SCHEMES.has(scheme) && !(scheme === 'https' && allowHttps)) {
            return fail('scheme', `Unsupported daemon URI scheme: ${scheme}`);
        }
    }

    // Strip userinfo — never put into engineUrl / logs.
    let hasUserinfo = false;
    const at = rest.lastIndexOf('@');
    if (at >= 0) {
        // Only treat as userinfo if @ is before the first path slash and not inside [...].
        const beforePath = rest.split('/')[0];
        if (beforePath.includes('@')) {
            hasUserinfo = true;
            rest = rest.slice(at + 1);
        }
    }

    let hostPort;
    let path = '';
    const slash = rest.indexOf('/');
    if (slash >= 0) {
        hostPort = rest.slice(0, slash);
        path = rest.slice(slash);
        if (path.length > 1 && path.endsWith('/')) {
            path = path.replace(/\/+$/, '') || '';
        }
    } else {
        hostPort = rest;
    }
    if (!hostPort) {
        return fail('host', 'Daemon host is missing');
    }

    let host;
    let portStr = null;
    if (hostPort.startsWith('[')) {
        const end = hostPort.indexOf(']');
        if (end < 0) {
            return fail('ipv6', 'Unclosed IPv6 bracket');
        }
        host = hostPort.slice(1, end);
        const after = hostPort.slice(end + 1);
        if (after === '') {
            portStr = null;
        } else if (after.startsWith(':')) {
            portStr = after.slice(1);
            if (!portStr) return fail('port', 'Empty port after IPv6 host');
        } else {
            return fail('ipv6', 'Garbage after IPv6 address');
        }
        if (!isIpv6(host)) {
            return fail('ipv6', 'Invalid IPv6 address');
        }
    } else {
        const colonCount = (hostPort.match(/:/g) || []).length;
        if (colonCount > 1) {
            // Bare IPv6 without brackets — reject (ambiguous with port).
            return fail('ipv6', 'Bare IPv6 requires brackets: [addr]:port');
        }
        if (colonCount === 1) {
            const idx = hostPort.indexOf(':');
            host = hostPort.slice(0, idx);
            portStr = hostPort.slice(idx + 1);
            if (!portStr) return fail('port', 'Empty port');
        } else {
            host = hostPort;
        }
    }

    if (!host) return fail('host', 'Daemon host is missing');
    if (/[^\x20-\x7E]/.test(host)) {
        return fail('idn', 'Non-ASCII hostnames (IDN) are not supported; use ASCII / punycode');
    }
    if (!isValidHostnameOrIp(host)) {
        return fail('host', 'Invalid daemon hostname or IP');
    }

    let port = DEFAULT_PORT;
    if (portStr != null) {
        if (!/^\d+$/.test(portStr)) {
            return fail('port', `Invalid port: ${portStr}`);
        }
        port = Number(portStr);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            return fail('port', `Port out of range: ${portStr}`);
        }
    }

    const engineUrl = isIpv6(host) ? `[${host}]:${port}` : `${host}:${port}`;
    return {
        ok: true,
        endpoint: {
            host,
            port,
            scheme: scheme || 'http',
            path: path || '',
            engineUrl,
            isLoopback: isLoopbackHost(host),
            hasUserinfo
        }
    };
}

function fail(code, message) {
    return { ok: false, code, message };
}

function isIpv6(host) {
    // Minimal structural check — full RFC validation is out of scope.
    if (!host || host.includes(' ')) return false;
    if (!host.includes(':')) return false;
    if (/[^0-9a-fA-F:.]/.test(host)) return false;
    return true;
}

function isIpv4(host) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (!m) return false;
    return m.slice(1).every((o) => {
        const n = Number(o);
        return n >= 0 && n <= 255 && String(n) === String(Number(o));
    });
}

function isValidHostnameOrIp(host) {
    if (isIpv4(host) || isIpv6(host)) return true;
    if (host.length > 253) return false;
    if (host.startsWith('.') || host.endsWith('.')) return false;
    // hostname labels
    return /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(host)
        || host === 'localhost';
}

function isLoopbackHost(host) {
    const h = host.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
    if (isIpv4(h) && h.startsWith('127.')) return true;
    return false;
}

module.exports = {
    DEFAULT_PORT,
    parseDaemonEndpoint,
    isLoopbackHost
};
