/**
 * Desktop settings persistence (#46) — localStorage-backed profiles.
 * Secrets (passwords/tokens) are never stored; wallet is user-owned address only.
 */

export const DESKTOP_SETTINGS_KEY = 'xmrig_desktop_settings_v1';

export function defaultDesktopStore(cpuThreads = 4) {
    const threads = Math.max(1, cpuThreads - 1);
    return {
        schemaVersion: 1,
        activeProfileId: 'default',
        profiles: [
            {
                id: 'default',
                name: 'Default',
                coin_type: 'monero',
                pool_url: 'gulf.moneroocean.stream:10128',
                custom_pool_url: '',
                use_custom_pool: false,
                wallet_address: '',
                worker_name: 'desktop',
                threads,
                algorithm: 'rx/0'
            }
        ]
    };
}

export function normalizeDesktopStore(raw, cpuThreads = 4) {
    const fallback = defaultDesktopStore(cpuThreads);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, store: fallback, error: 'invalid store' };
    }
    const profiles = Array.isArray(raw.profiles) ? raw.profiles : [];
    if (profiles.length === 0) {
        return { ok: false, store: fallback, error: 'no profiles' };
    }
    const cleaned = profiles.map((p, i) => ({
        id: typeof p.id === 'string' && p.id ? p.id : `profile-${i}`,
        name: typeof p.name === 'string' && p.name ? p.name : `Profile ${i + 1}`,
        coin_type: typeof p.coin_type === 'string' ? p.coin_type : 'monero',
        pool_url: typeof p.pool_url === 'string' ? p.pool_url : '',
        custom_pool_url: typeof p.custom_pool_url === 'string' ? p.custom_pool_url : '',
        use_custom_pool: Boolean(p.use_custom_pool),
        wallet_address: typeof p.wallet_address === 'string' ? p.wallet_address : '',
        worker_name: typeof p.worker_name === 'string' ? p.worker_name : 'desktop',
        threads: Math.max(1, Math.min(cpuThreads, Number(p.threads) || fallback.profiles[0].threads)),
        algorithm: typeof p.algorithm === 'string' ? p.algorithm : 'rx/0'
    }));
    let active = typeof raw.activeProfileId === 'string' ? raw.activeProfileId : cleaned[0].id;
    if (!cleaned.some((p) => p.id === active)) active = cleaned[0].id;
    return {
        ok: true,
        store: { schemaVersion: 1, activeProfileId: active, profiles: cleaned },
        error: null
    };
}

export function loadDesktopStore(storage = globalThis.localStorage, cpuThreads = 4) {
    try {
        if (!storage) {
            return { ok: false, store: defaultDesktopStore(cpuThreads), error: 'no storage' };
        }
        const text = storage.getItem(DESKTOP_SETTINGS_KEY);
        if (!text) return { ok: true, store: defaultDesktopStore(cpuThreads), error: null, fresh: true };
        return { ...normalizeDesktopStore(JSON.parse(text), cpuThreads), fresh: false };
    } catch (e) {
        return { ok: false, store: defaultDesktopStore(cpuThreads), error: e.message || String(e) };
    }
}

export function saveDesktopStore(store, storage = globalThis.localStorage) {
    try {
        if (!storage) return { ok: false, error: 'no storage' };
        const safe = {
            ...store,
            profiles: (store.profiles || []).map((p) => {
                const { password, token, secret, ...rest } = p;
                return rest;
            })
        };
        storage.setItem(DESKTOP_SETTINGS_KEY, JSON.stringify(safe));
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message || String(e) };
    }
}

export function getActiveProfile(store) {
    return store.profiles.find((p) => p.id === store.activeProfileId) || store.profiles[0];
}
