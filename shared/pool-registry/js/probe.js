/**
 * Controlled endpoint probe (#41): DNS → TCP → (optional) TLS.
 * No stratum login by default (would send wallet material). Rate-limited; not for CI against public pools.
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * @param {{ host: string, port: number, tls?: boolean, timeoutMs?: number, allowTls?: boolean }} opts
 */
export async function probeEndpoint(opts) {
    const host = opts.host;
    const port = opts.port;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const wantTls = opts.tls === true;
    const layers = {
        dns: { ok: false },
        tcp: { ok: false },
        tls: { ok: null, skipped: true }
    };

    try {
        const addresses = await dns.lookup(host, { all: true });
        layers.dns = {
            ok: true,
            addresses: addresses.map((a) => ({ address: a.address, family: a.family }))
        };
    } catch (e) {
        layers.dns = { ok: false, error: e.code || e.message };
        return summarize(host, port, wantTls, layers);
    }

    const tcp = await tcpConnect(host, port, timeoutMs);
    layers.tcp = tcp;
    if (!tcp.ok) {
        return summarize(host, port, wantTls, layers);
    }

    if (wantTls) {
        if (opts.allowTls === false) {
            layers.tls = {
                ok: false,
                skipped: false,
                error: 'TLS requested but runtime/policy disallows TLS (no silent plaintext fallback)'
            };
        } else {
            layers.tls = await tlsHandshake(host, port, timeoutMs);
        }
    }

    return summarize(host, port, wantTls, layers);
}

function summarize(host, port, wantTls, layers) {
    let status = 'unreachable';
    if (layers.dns.ok && layers.tcp.ok) {
        if (wantTls) {
            status = layers.tls?.ok ? 'tls-ok' : 'tls-failed';
        } else {
            status = 'tcp-ok';
        }
    } else if (layers.dns.ok) {
        status = 'dns-ok-tcp-failed';
    } else {
        status = 'dns-failed';
    }
    return {
        host,
        port,
        tlsRequested: wantTls,
        status,
        layers,
        // Protocol negotiation intentionally absent unless explicitly enabled later
        protocol: { ok: null, skipped: true, reason: 'stratum/login probe disabled by default (#41)' }
    };
}

function tcpConnect(host, port, timeoutMs) {
    return new Promise((resolve) => {
        const socket = net.connect({ host, port });
        const timer = setTimeout(() => {
            socket.destroy();
            resolve({ ok: false, error: 'TIMEOUT' });
        }, timeoutMs);
        socket.on('connect', () => {
            clearTimeout(timer);
            socket.end();
            resolve({ ok: true });
        });
        socket.on('error', (e) => {
            clearTimeout(timer);
            resolve({ ok: false, error: e.code || e.message });
        });
    });
}

function tlsHandshake(host, port, timeoutMs) {
    return new Promise((resolve) => {
        const socket = tls.connect({
            host,
            port,
            servername: host,
            rejectUnauthorized: true
        });
        const timer = setTimeout(() => {
            socket.destroy();
            resolve({ ok: false, skipped: false, error: 'TIMEOUT' });
        }, timeoutMs);
        socket.on('secureConnect', () => {
            clearTimeout(timer);
            const cert = socket.getPeerCertificate();
            socket.end();
            resolve({
                ok: true,
                skipped: false,
                authorized: socket.authorized,
                protocol: socket.getProtocol(),
                // De-identify: no full cert PEM
                subjectCN: cert?.subject?.CN || null
            });
        });
        socket.on('error', (e) => {
            clearTimeout(timer);
            resolve({ ok: false, skipped: false, error: e.code || e.message });
        });
    });
}
