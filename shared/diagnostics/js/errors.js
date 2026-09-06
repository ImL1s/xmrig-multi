/**
 * Deterministic error code mapping (#55).
 */

/** @typedef {'info'|'warn'|'error'|'critical'} Severity */

/**
 * @type {Record<string, {
 *   severity: Severity,
 *   reason: string,
 *   actions: string[],
 *   settingsPath?: string
 * }>}
 */
export const ERROR_CATALOG = {
    BAD_WALLET: {
        severity: 'error',
        reason: 'Wallet address failed validation for the selected coin/pool',
        actions: ['open-wallet-settings', 'revalidate-address'],
        settingsPath: 'config.wallet'
    },
    TLS_HANDSHAKE: {
        severity: 'error',
        reason: 'TLS handshake with pool/daemon failed',
        actions: ['check-tls-toggle', 'retry-connection', 'open-pool-settings'],
        settingsPath: 'config.pool'
    },
    NETWORK: {
        severity: 'warn',
        reason: 'Network unreachable or timed out',
        actions: ['retry-connection', 'check-connectivity'],
        settingsPath: 'config.pool'
    },
    POOL_AUTH: {
        severity: 'error',
        reason: 'Pool rejected login (wallet/password/worker)',
        actions: ['open-pool-settings', 'revalidate-address'],
        settingsPath: 'config.pool'
    },
    UNSUPPORTED_ALGORITHM: {
        severity: 'error',
        reason: 'Selected algorithm is not supported by this engine build',
        actions: ['open-algorithm-settings', 'use-recommended-algo'],
        settingsPath: 'config.algorithm'
    },
    NATIVE_BINARY_MISSING: {
        severity: 'critical',
        reason: 'Miner binary missing or not packaged for this platform',
        actions: ['open-diagnostics', 'reinstall-or-rebuild'],
        settingsPath: 'diagnostics'
    },
    ABI_MISMATCH: {
        severity: 'critical',
        reason: 'Native binary ABI does not match this device',
        actions: ['open-diagnostics', 'install-matching-build'],
        settingsPath: 'diagnostics'
    },
    MEMORY: {
        severity: 'error',
        reason: 'Insufficient memory for requested RandomX mode',
        actions: ['switch-randomx-light', 'reduce-threads'],
        settingsPath: 'config.randomx'
    },
    THERMAL: {
        severity: 'warn',
        reason: 'Thermal policy paused or throttled mining',
        actions: ['open-thermal-settings', 'wait-cooldown'],
        settingsPath: 'policy.thermal'
    },
    BACKGROUND_RESTRICTED: {
        severity: 'warn',
        reason: 'OS background / FGS / quota restriction blocked mining',
        actions: ['open-runtime-help', 'start-from-foreground'],
        settingsPath: 'runtime'
    }
};

/**
 * @param {string|null|undefined} code
 * @param {string} [rawMessage]
 */
export function mapError(code, rawMessage = '') {
    const key = String(code || '').trim().toUpperCase();
    const entry = ERROR_CATALOG[key];
    if (!entry) {
        return {
            code: key || 'UNKNOWN',
            known: false,
            severity: 'error',
            reason: 'Unrecognized error — see raw message',
            actions: ['open-diagnostics', 'copy-raw'],
            settingsPath: 'diagnostics',
            rawMessage: rawMessage || ''
        };
    }
    return {
        code: key,
        known: true,
        severity: entry.severity,
        reason: entry.reason,
        actions: [...entry.actions],
        settingsPath: entry.settingsPath || 'diagnostics',
        rawMessage: rawMessage || ''
    };
}

/**
 * Infer code from a free-form backend line when no structured code exists.
 * @param {string} message
 */
export function inferErrorCode(message) {
    const m = String(message || '').toLowerCase();
    if (/wallet|address.*invalid|invalid.*address/.test(m)) return 'BAD_WALLET';
    if (/tls|ssl|certificate|handshake/.test(m)) return 'TLS_HANDSHAKE';
    if (/auth|login failed|unauthorized|forbidden/.test(m)) return 'POOL_AUTH';
    if (/unsupported.*algo|unknown algorithm/.test(m)) return 'UNSUPPORTED_ALGORITHM';
    if (/xmrig.*not found|binary not found|enoent.*xmrig/.test(m)) return 'NATIVE_BINARY_MISSING';
    if (/abi|elf class|wrong architecture/.test(m)) return 'ABI_MISMATCH';
    if (/out of memory|cannot allocate|oom|randomx.*memory/.test(m)) return 'MEMORY';
    if (/thermal|overheat|temperature/.test(m)) return 'THERMAL';
    if (/foreground service|fgs|quota|background.*restrict|start not allowed/.test(m)) {
        return 'BACKGROUND_RESTRICTED';
    }
    if (/timeout|econnrefused|network|unreachable|dns/.test(m)) return 'NETWORK';
    return 'UNKNOWN';
}
