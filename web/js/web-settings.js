/**
 * Web settings load/save with validation (#47).
 * UI must apply this model after building controls — never let render overwrite the model silently.
 */

export const SETTINGS_STORAGE_KEY = 'xmrig_web_settings';
export const SETTINGS_SCHEMA_VERSION = 1;

/**
 * @param {unknown} raw
 * @param {{ cores?: number }} [opts]
 * @returns {{ ok: true, settings: object, warnings: string[] } | { ok: false, error: string, settings: object }}
 */
export function normalizeWebSettings(raw, opts = {}) {
    const cores = Math.max(1, opts.cores || 4);
    const warnings = [];
    const defaults = {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        coinSelect: 'monero',
        walletAddress: '',
        poolSelect: 'moneroocean',
        customProxyUrl: '',
        threads: Math.max(1, Math.floor(cores / 2)),
        workerName: 'web-worker'
    };

    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, error: 'settings must be an object', settings: defaults };
    }

    const out = { ...defaults };
    if (typeof raw.coinSelect === 'string' && raw.coinSelect) out.coinSelect = raw.coinSelect;
    if (typeof raw.walletAddress === 'string') out.walletAddress = raw.walletAddress;
    if (typeof raw.poolSelect === 'string' && raw.poolSelect) out.poolSelect = raw.poolSelect;
    if (typeof raw.customProxyUrl === 'string') out.customProxyUrl = raw.customProxyUrl;
    if (typeof raw.workerName === 'string') out.workerName = raw.workerName;

    if (raw.threads != null) {
        const t = Number(raw.threads);
        if (!Number.isFinite(t) || t < 1) {
            warnings.push(`Invalid threads ${raw.threads}; using ${out.threads}`);
        } else if (t > cores) {
            warnings.push(`Saved threads ${t} exceed available ${cores}; clamped`);
            out.threads = cores;
            out.requestedThreads = t;
        } else {
            out.threads = Math.floor(t);
        }
    }

    out.schemaVersion = SETTINGS_SCHEMA_VERSION;
    return { ok: true, settings: out, warnings };
}

export function loadWebSettingsFromStorage(storage = globalThis.localStorage, opts = {}) {
    const cores = Math.max(1, opts.cores || (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4);
    try {
        if (!storage) {
            return {
                ok: false,
                error: 'storage unavailable',
                settings: normalizeWebSettings({}, { cores }).settings,
                warnings: ['localStorage unavailable; session-only settings']
            };
        }
        const rawText = storage.getItem(SETTINGS_STORAGE_KEY);
        if (rawText == null || rawText === '') {
            return { ok: true, settings: normalizeWebSettings({}, { cores }).settings, warnings: [] };
        }
        let parsed;
        try {
            parsed = JSON.parse(rawText);
        } catch (e) {
            return {
                ok: false,
                error: `malformed JSON: ${e.message}`,
                settings: normalizeWebSettings({}, { cores }).settings,
                warnings: ['Corrupt settings ignored; using defaults']
            };
        }
        const normalized = normalizeWebSettings(parsed, { cores });
        if (!normalized.ok) {
            return {
                ok: false,
                error: normalized.error,
                settings: normalized.settings,
                warnings: ['Invalid settings shape; using defaults']
            };
        }
        return { ok: true, settings: normalized.settings, warnings: normalized.warnings };
    } catch (e) {
        const msg = e && e.name === 'SecurityError' ? 'storage blocked' : (e.message || String(e));
        return {
            ok: false,
            error: msg,
            settings: normalizeWebSettings({}, { cores }).settings,
            warnings: [`Cannot read settings (${msg}); session-only`]
        };
    }
}

export function saveWebSettingsToStorage(settings, storage = globalThis.localStorage) {
    try {
        if (!storage) return { ok: false, error: 'storage unavailable' };
        const payload = {
            ...settings,
            schemaVersion: SETTINGS_SCHEMA_VERSION
        };
        storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message || String(e) };
    }
}
