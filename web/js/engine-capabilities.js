/**
 * Declared engine capabilities for the Web RandomX.js backend (#26).
 * Only Monero RandomX (rx/0) over Stratum is verified for the packaged WASM path.
 */

export const WEB_ENGINE_CAPABILITIES = {
    platform: 'web',
    backend: 'randomx.js',
    upstream: 'randomx-js (WASM)',
    evidenceLevel: 'partial',
    algorithms: {
        'rx/0': {
            status: 'supported',
            protocol: 'stratum',
            coin: 'monero',
            reason: 'RandomX WASM worker + XMRig-compatible compact-target gate (#25)'
        },
        'rx/wow': {
            status: 'unavailable',
            protocol: 'stratum',
            coin: 'wownero',
            reason: 'Web worker always creates RandomX VM without RandomWOW / signing path (#26/#28)'
        },
        'astrobwt/v3': {
            status: 'unavailable',
            protocol: 'dero-daemon',
            coin: 'dero',
            reason: 'DERO requires dero-miner / daemon RPC, not XMRig Stratum (#27)'
        }
    },
    coins: {
        monero: { status: 'supported', algorithms: ['rx/0'] },
        wownero: { status: 'unavailable', algorithms: ['rx/wow'] },
        dero: { status: 'unavailable', algorithms: ['astrobwt/v3'] }
    }
};

/**
 * @param {string} coin monero|wownero|dero
 * @returns {{ allowed: true } | { allowed: false, status: string, reason: string }}
 */
export function assertWebCoinStartAllowed(coin) {
    const entry = WEB_ENGINE_CAPABILITIES.coins[coin];
    if (!entry) {
        return { allowed: false, status: 'unavailable', reason: `Unknown coin: ${coin}` };
    }
    if (entry.status !== 'supported') {
        return {
            allowed: false,
            status: entry.status,
            reason: WEB_ENGINE_CAPABILITIES.algorithms[entry.algorithms[0]]?.reason ||
                `${coin} is not supported by the Web RandomX backend`
        };
    }
    return { allowed: true };
}

/** MoneroOcean pays XMR; reject WOW (and other non-XMR) payout addresses (#29). */
export function isMoneroOceanPoolKey(poolKey) {
    if (!poolKey) return false;
    const key = String(poolKey).toLowerCase();
    return key === 'moneroocean' || key.includes('moneroocean');
}

export function assertMoneroOceanPayoutAddress(poolKey, coin, walletAddress) {
    if (!isMoneroOceanPoolKey(poolKey)) {
        return { ok: true };
    }
    if (coin !== 'monero') {
        return {
            ok: false,
            error: 'MoneroOcean 以 XMR 收款，請使用 Monero 幣種與 Monero 地址，不可把 WOW/DERO 地址當付款帳號 (#29)'
        };
    }
    const addr = (walletAddress || '').trim();
    if (!(addr.startsWith('4') || addr.startsWith('8')) || addr.length < 95) {
        return {
            ok: false,
            error: 'MoneroOcean 需要有效的 Monero 收款地址（4… / 8…）'
        };
    }
    return { ok: true };
}
