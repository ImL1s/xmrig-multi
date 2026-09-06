/**
 * Daemon / solo endpoint URL parser (#44).
 */

const DEFAULT_PORT = 18081;

/**
 * @typedef {object} ParsedDaemon
 * @property {boolean} ok
 * @property {string} [host]
 * @property {number} [port]
 * @property {string} [scheme] http|https|null (null = bare host:port)
 * @property {boolean} [tls]
 * @property {string} [path]
 * @property {string} [engineUrl] host:port or [ipv6]:port for XMRig
 * @property {boolean} [isLoopback]
 * @property {string} [error]
 * @property {string} [code]
 * @property {boolean} [hasUserinfo]
 */

/**
 * @param {string} raw
 * @param {{ allowHttps?: boolean }} [opts]
 * @returns {ParsedDaemon}
 */
export function parseDaemonEndpoint(raw, opts = {}) {
    const allowHttps = opts.allowHttps !== false;
    if (raw == null || typeof raw !== 'string' || !raw.trim()) {
        return fail('empty', 'daemon URL is required');
    }
    let input = raw.trim();
    // Strip surrounding whitespace / zero-width
    input = input.replace(/[\u200B-\u200D\uFEFF]/g, '');

    let hasUserinfo = false;
    let scheme = null;
    let path = '';

    const schemeMatch = input.match(/^(https?):\/\//i);
    if (schemeMatch) {
        scheme = schemeMatch[1].toLowerCase();
        input = input.slice(schemeMatch[0].length);
        if (scheme === 'https' && !allowHttps) {
            return fail('tls_unsupported', 'https daemon requires TLS capability — refusing silent http downgrade');
        }
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
        const s = input.split(':', 1)[0].toLowerCase();
        return fail('bad_scheme', `unsupported scheme "${s}"`);
    }

    // userinfo
    const at = input.lastIndexOf('@');
    if (at !== -1) {
        hasUserinfo = true;
        input = input.slice(at + 1);
    }

    // path / query
    const pathIdx = input.search(/[/?#]/);
    if (pathIdx !== -1) {
        path = input.slice(pathIdx).split(/[?#]/)[0] || '';
        input = input.slice(0, pathIdx);
    }

    let host;
    let port;
    let portExplicit = false;

    if (input.startsWith('[')) {
        const end = input.indexOf(']');
        if (end === -1) return fail('bad_ipv6', 'IPv6 host missing closing bracket');
        host = input.slice(1, end);
        const rest = input.slice(end + 1);
        if (rest.startsWith(':')) {
            portExplicit = true;
            port = parsePort(rest.slice(1));
            if (port.error) return fail(port.code, port.error);
            port = port.value;
        } else if (rest) {
            return fail('bad_ipv6', 'unexpected characters after IPv6 host');
        } else {
            port = DEFAULT_PORT;
        }
        if (!isIpv6(host)) return fail('bad_ipv6', 'invalid IPv6 address');
    } else {
        // IPv4 or hostname, optional :port
        const colon = input.lastIndexOf(':');
        if (colon !== -1 && input.indexOf(':') === colon) {
            host = input.slice(0, colon);
            const portPart = input.slice(colon + 1);
            if (portPart === '') return fail('bad_port', 'port missing after colon');
            portExplicit = true;
            const p = parsePort(portPart);
            if (p.error) return fail(p.code, p.error);
            port = p.value;
        } else if ((input.match(/:/g) || []).length > 1) {
            // bare IPv6 without brackets — accept as host, default port
            host = input;
            if (!isIpv6(host)) return fail('bad_ipv6', 'bare IPv6 must use [addr]:port form when port is set');
            port = DEFAULT_PORT;
        } else {
            host = input;
            port = DEFAULT_PORT;
        }
    }

    host = host.trim().toLowerCase();
    if (!host) return fail('bad_host', 'host is required');
    if (host.includes(' ')) return fail('bad_host', 'host contains whitespace');
    // Reject the classic bug: scheme left as host
    if (host === 'http' || host === 'https') {
        return fail('bad_host', 'scheme was parsed as host — use http://host:port');
    }

    const tls = scheme === 'https';
    const engineUrl = host.includes(':') && !host.includes('.')
        ? `[${host}]:${port}`
        : (isIpv6(host) ? `[${host}]:${port}` : `${host}:${port}`);

    return {
        ok: true,
        host,
        port,
        scheme,
        tls,
        path: path || '',
        engineUrl,
        isLoopback: isLoopback(host),
        hasUserinfo,
        portExplicit,
        warning: hasUserinfo
            ? 'URI userinfo ignored — put RPC credentials in a separate secret field; never log userinfo'
            : undefined
    };
}

function parsePort(part) {
    if (!/^\d+$/.test(part)) return { error: 'port must be numeric', code: 'bad_port' };
    const n = Number(part);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
        return { error: `port out of range: ${part}`, code: 'bad_port' };
    }
    return { value: n };
}

function isIpv6(host) {
    // Loose check — enough to reject obvious garbage; full RFC not required for UI gate
    return host.includes(':') && /^[0-9a-f:]+$/i.test(host);
}

function isLoopback(host) {
    return host === 'localhost'
        || host === '127.0.0.1'
        || host === '::1'
        || host === '0:0:0:0:0:0:0:1';
}

function fail(code, error) {
    return { ok: false, code, error };
}

export { DEFAULT_PORT };
