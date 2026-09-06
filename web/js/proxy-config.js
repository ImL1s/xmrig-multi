/**
 * Web Stratum-over-WebSocket proxy resolution (#50).
 * Never silently bind public/mobile pages to the visitor's localhost:3333.
 */

export const PROXY_ERROR = {
    MISSING: 'missing_config',
    MIXED_CONTENT: 'mixed_content',
    INVALID_SCHEME: 'invalid_scheme',
    TLS_DOWNGRADE: 'tls_downgrade',
    OFFLINE: 'proxy_offline',
    ORIGIN_DENIED: 'origin_denied',
    POOL_FAILED: 'pool_failed'
};

/**
 * @param {string} hostname
 */
export function isLoopbackHost(hostname) {
    const h = String(hostname || '').toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

/**
 * @param {Pick<Location,'protocol'|'hostname'|'port'|'host'>} loc
 * @param {{ proxyUrl?: string, sameOriginPath?: string, allowDevLocalhostDefault?: boolean, proxyKind?: string, trustNotice?: string }} [deployment]
 */
export function resolveProxyEndpoint(loc, deployment = {}, userProxyUrl = '') {
    const user = String(userProxyUrl || '').trim();
    if (user) {
        const validated = validateProxyUrl(user, loc);
        if (!validated.ok) {
            return { ok: false, url: null, source: 'user', kind: 'user', error: validated.error, code: validated.code };
        }
        return {
            ok: true,
            url: validated.url,
            source: 'user',
            kind: classifyKind(validated.url, loc),
            trustNotice: deployment.trustNotice || null,
            requiresRemoteConfirm: isRemoteProxy(validated.url, loc)
        };
    }

    if (deployment.proxyUrl) {
        const validated = validateProxyUrl(deployment.proxyUrl, loc);
        if (!validated.ok) {
            return { ok: false, url: null, source: 'deployment', kind: deployment.proxyKind || 'deployment', error: validated.error, code: validated.code };
        }
        return {
            ok: true,
            url: validated.url,
            source: 'deployment',
            kind: deployment.proxyKind || classifyKind(validated.url, loc),
            trustNotice: deployment.trustNotice || null,
            requiresRemoteConfirm: isRemoteProxy(validated.url, loc)
        };
    }

    // Explicit same-origin WSS path for HTTPS deployments (must be configured).
    if (loc.protocol === 'https:' && deployment.sameOriginPath) {
        const path = deployment.sameOriginPath.startsWith('/')
            ? deployment.sameOriginPath
            : `/${deployment.sameOriginPath}`;
        const url = `wss://${loc.host}${path}`;
        return {
            ok: true,
            url,
            source: 'deployment-same-origin',
            kind: 'same-origin',
            trustNotice: deployment.trustNotice || null,
            requiresRemoteConfirm: false
        };
    }

    // Dev-only visible default — never for public HTTPS / non-loopback hosts.
    const allowDev = deployment.allowDevLocalhostDefault !== false;
    if (allowDev && isLoopbackHost(loc.hostname) && (loc.protocol === 'http:' || loc.protocol === 'https:')) {
        const url = `ws://127.0.0.1:3333`;
        return {
            ok: true,
            url,
            source: 'dev-default',
            kind: 'local-dev',
            trustNotice: 'Development default — only valid when the local proxy is running on this machine.',
            requiresRemoteConfirm: false,
            visibleRequired: true
        };
    }

    // LAN HTTP self-host: suggest same host :3333 but still require visibility / user can edit.
    if (loc.protocol === 'http:' && !isLoopbackHost(loc.hostname)) {
        const url = `ws://${loc.hostname}:3333`;
        return {
            ok: true,
            url,
            source: 'lan-suggest',
            kind: 'lan',
            trustNotice: 'Suggested LAN proxy on the same host. Confirm the proxy is yours before mining.',
            requiresRemoteConfirm: false,
            visibleRequired: true
        };
    }

    return {
        ok: false,
        url: null,
        source: 'none',
        kind: 'required-user',
        error: 'No proxy configured for this deployment. Set deployment.proxyUrl / sameOriginPath or enter a WebSocket proxy URL.',
        code: PROXY_ERROR.MISSING
    };
}

/**
 * @param {string} url
 * @param {Pick<Location,'protocol'|'hostname'>} loc
 */
export function validateProxyUrl(url, loc) {
    if (!url || typeof url !== 'string') {
        return { ok: false, error: 'Proxy URL is required', code: PROXY_ERROR.MISSING };
    }
    const trimmed = url.trim();
    if (!trimmed.startsWith('ws://') && !trimmed.startsWith('wss://')) {
        return { ok: false, error: 'Proxy URL must start with ws:// or wss://', code: PROXY_ERROR.INVALID_SCHEME };
    }
    // Never silently downgrade: HTTPS page must not use ws:// (mixed content / TLS bypass).
    if (loc.protocol === 'https:' && trimmed.startsWith('ws://')) {
        return {
            ok: false,
            error: 'HTTPS pages require wss:// — refusing silent TLS downgrade to ws://',
            code: PROXY_ERROR.TLS_DOWNGRADE
        };
    }
    if (loc.protocol === 'https:' && trimmed.startsWith('ws://')) {
        return { ok: false, error: 'Mixed content blocked', code: PROXY_ERROR.MIXED_CONTENT };
    }
    return { ok: true, url: trimmed };
}

export function classifyKind(url, loc) {
    try {
        const u = new URL(url.replace(/^ws/i, 'http'));
        if (isLoopbackHost(u.hostname)) return 'local-dev';
        if (u.hostname === loc.hostname) return 'same-origin';
        if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(u.hostname)) return 'lan';
        return 'remote';
    } catch {
        return 'unknown';
    }
}

export function isRemoteProxy(url, loc) {
    return classifyKind(url, loc) === 'remote';
}

/**
 * Map browser / handshake failures to layered diagnostics (#50).
 */
export function diagnoseProxyFailure({ code, readyState, pageProtocol, proxyUrl, message } = {}) {
    if (pageProtocol === 'https:' && String(proxyUrl || '').startsWith('ws://')) {
        return {
            layer: PROXY_ERROR.MIXED_CONTENT,
            userMessage: 'Blocked mixed content: HTTPS page cannot open ws:// proxy. Use wss://.'
        };
    }
    if (code === 1006 || readyState === 3) {
        return {
            layer: PROXY_ERROR.OFFLINE,
            userMessage: 'Proxy offline or unreachable (WebSocket closed abnormally). Check the proxy process and URL.'
        };
    }
    if (/cert|SSL|TLS|certificate/i.test(String(message || ''))) {
        return {
            layer: 'certificate_failed',
            userMessage: 'TLS/certificate failure talking to proxy. Fix the certificate — no silent downgrade.'
        };
    }
    if (/origin|403|denied/i.test(String(message || ''))) {
        return {
            layer: PROXY_ERROR.ORIGIN_DENIED,
            userMessage: 'Proxy rejected this page Origin. Update the proxy allowlist.'
        };
    }
    if (/pool|stratum|login/i.test(String(message || ''))) {
        return {
            layer: PROXY_ERROR.POOL_FAILED,
            userMessage: 'Proxy reachable but pool/login failed. Check pool endpoint and wallet login.'
        };
    }
    return {
        layer: 'unknown',
        userMessage: message || 'Proxy connection failed'
    };
}

/**
 * Probe WebSocket reachability without mining / without sending wallet secrets.
 * @returns {Promise<{ok:boolean, layer?:string, userMessage?:string, ms?:number}>}
 */
export function testProxyHandshake(proxyUrl, { timeoutMs = 4000, WebSocketImpl = globalThis.WebSocket } = {}) {
    return new Promise((resolve) => {
        if (!WebSocketImpl) {
            resolve({ ok: false, layer: PROXY_ERROR.MISSING, userMessage: 'WebSocket unavailable' });
            return;
        }
        const started = Date.now();
        let settled = false;
        let ws;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            try { ws?.close(); } catch { /* ignore */ }
            resolve({ ...result, ms: Date.now() - started });
        };
        try {
            ws = new WebSocketImpl(proxyUrl);
        } catch (e) {
            finish(diagnoseProxyFailure({ message: e.message, proxyUrl }));
            return;
        }
        const timer = setTimeout(() => {
            finish({ ok: false, layer: PROXY_ERROR.OFFLINE, userMessage: 'Proxy handshake timed out' });
        }, timeoutMs);
        ws.onopen = () => {
            clearTimeout(timer);
            finish({ ok: true, userMessage: 'WebSocket open (handshake OK; pool login not tested)' });
        };
        ws.onerror = () => {
            clearTimeout(timer);
            finish(diagnoseProxyFailure({ readyState: ws.readyState, proxyUrl, message: 'error' }));
        };
        ws.onclose = (ev) => {
            clearTimeout(timer);
            if (!settled) {
                finish(diagnoseProxyFailure({ code: ev.code, readyState: 3, proxyUrl, message: ev.reason }));
            }
        };
    });
}
