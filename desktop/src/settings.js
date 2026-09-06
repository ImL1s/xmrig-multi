/**
 * Desktop settings persistence (#46) — localStorage-backed multi-profile store.
 * Secrets (passwords/tokens) are never stored; wallet is user-owned address only.
 * Portable fields stay intact across CPU changes; local overrides (threads/affinity)
 * are flagged for re-resolve on import.
 */

export const DESKTOP_SETTINGS_KEY = 'xmrig_desktop_settings_v1';
export const DESKTOP_SETTINGS_BACKUP_KEY = 'xmrig_desktop_settings_v1_backup';

const PORTABLE_KEYS = [
    'name',
    'coin_type',
    'pool_url',
    'custom_pool_url',
    'use_custom_pool',
    'wallet_address',
    'worker_name',
    'algorithm'
];

export function defaultProfile(cpuThreads = 4, id = 'default', name = 'Default') {
    return {
        id,
        name,
        coin_type: 'monero',
        pool_url: 'gulf.moneroocean.stream:10128',
        custom_pool_url: '',
        use_custom_pool: false,
        wallet_address: '',
        worker_name: 'desktop',
        threads: Math.max(1, cpuThreads - 1),
        algorithm: 'rx/0',
        randomx_mode: 'auto',
        locks: [],
        localOverrides: {
            threads: true
        }
    };
}

export function defaultDesktopStore(cpuThreads = 4) {
    return {
        schemaVersion: 1,
        activeProfileId: 'default',
        profiles: [defaultProfile(cpuThreads)]
    };
}

export function normalizeDesktopStore(raw, cpuThreads = 4) {
    const fallback = defaultDesktopStore(cpuThreads);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, store: fallback, error: 'invalid store' };
    }
    if (raw.schemaVersion != null && Number(raw.schemaVersion) > 1) {
        return { ok: false, store: fallback, error: `unsupported schemaVersion ${raw.schemaVersion}` };
    }
    const profiles = Array.isArray(raw.profiles) ? raw.profiles : [];
    if (profiles.length === 0) {
        return { ok: false, store: fallback, error: 'no profiles' };
    }
    const cleaned = profiles.map((p, i) => normalizeProfile(p, i, cpuThreads, fallback.profiles[0].threads));
    let active = typeof raw.activeProfileId === 'string' ? raw.activeProfileId : cleaned[0].id;
    if (!cleaned.some((p) => p.id === active)) active = cleaned[0].id;
    return {
        ok: true,
        store: { schemaVersion: 1, activeProfileId: active, profiles: cleaned },
        error: null
    };
}

function normalizeProfile(p, i, cpuThreads, defaultThreads) {
    const threadsRaw = Number(p?.threads);
    const threads = Number.isFinite(threadsRaw)
        ? Math.max(1, Math.min(cpuThreads, threadsRaw))
        : defaultThreads;
    return {
        id: typeof p?.id === 'string' && p.id ? p.id : `profile-${i}`,
        name: typeof p?.name === 'string' && p.name ? p.name : `Profile ${i + 1}`,
        coin_type: typeof p?.coin_type === 'string' ? p.coin_type : 'monero',
        pool_url: typeof p?.pool_url === 'string' ? p.pool_url : '',
        custom_pool_url: typeof p?.custom_pool_url === 'string' ? p.custom_pool_url : '',
        use_custom_pool: Boolean(p?.use_custom_pool),
        wallet_address: typeof p?.wallet_address === 'string' ? p.wallet_address : '',
        worker_name: typeof p?.worker_name === 'string' ? p.worker_name : 'desktop',
        threads,
        algorithm: typeof p?.algorithm === 'string' ? p.algorithm : 'rx/0',
        randomx_mode: normalizeRandomxMode(p?.randomx_mode),
        locks: Array.isArray(p?.locks) ? p.locks.filter((x) => typeof x === 'string') : [],
        localOverrides: {
            threads: p?.localOverrides?.threads !== false,
            ...(p?.localOverrides && typeof p.localOverrides === 'object' ? p.localOverrides : {})
        }
    };
}

function normalizeRandomxMode(mode) {
    const m = String(mode || 'auto').toLowerCase();
    if (m === 'fast' || m === 'light' || m === 'auto') return m;
    return 'auto';
}

export function loadDesktopStore(storage = globalThis.localStorage, cpuThreads = 4) {
    try {
        if (!storage) {
            return { ok: false, store: defaultDesktopStore(cpuThreads), error: 'no storage', fresh: true };
        }
        const text = storage.getItem(DESKTOP_SETTINGS_KEY);
        if (!text) {
            return { ok: true, store: defaultDesktopStore(cpuThreads), error: null, fresh: true };
        }
        return { ...normalizeDesktopStore(JSON.parse(text), cpuThreads), fresh: false };
    } catch (e) {
        return { ok: false, store: defaultDesktopStore(cpuThreads), error: e.message || String(e), fresh: false };
    }
}

export function saveDesktopStore(store, storage = globalThis.localStorage) {
    try {
        if (!storage) return { ok: false, error: 'no storage' };
        const safe = stripSecrets(store);
        const payload = JSON.stringify(safe);
        // Soft backup for recovery after corrupt primary write races.
        try {
            const prev = storage.getItem(DESKTOP_SETTINGS_KEY);
            if (prev) storage.setItem(DESKTOP_SETTINGS_BACKUP_KEY, prev);
        } catch {
            /* ignore backup failures */
        }
        storage.setItem(DESKTOP_SETTINGS_KEY, payload);
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message || String(e) };
    }
}

function stripSecrets(store) {
    return {
        ...store,
        profiles: (store.profiles || []).map((p) => {
            const { password, token, secret, ...rest } = p;
            return rest;
        })
    };
}

export function getActiveProfile(store) {
    return store.profiles.find((p) => p.id === store.activeProfileId) || store.profiles[0];
}

export function createProfile(store, cpuThreads = 4, name = 'New profile') {
    const id = `profile-${Date.now().toString(36)}`;
    const profile = defaultProfile(cpuThreads, id, name);
    return {
        store: {
            ...store,
            activeProfileId: id,
            profiles: [...store.profiles, profile]
        },
        profile
    };
}

export function duplicateProfile(store, profileId, cpuThreads = 4) {
    const src = store.profiles.find((p) => p.id === profileId) || getActiveProfile(store);
    const id = `profile-${Date.now().toString(36)}`;
    const copy = {
        ...structuredCloneSafe(src),
        id,
        name: `${src.name} copy`
    };
    copy.threads = Math.max(1, Math.min(cpuThreads, copy.threads || 1));
    return {
        store: {
            ...store,
            activeProfileId: id,
            profiles: [...store.profiles, copy]
        },
        profile: copy
    };
}

export function renameProfile(store, profileId, name) {
    const nextName = String(name || '').trim() || 'Untitled';
    return {
        ...store,
        profiles: store.profiles.map((p) => (p.id === profileId ? { ...p, name: nextName } : p))
    };
}

/**
 * Delete a profile. Refuses to delete the last remaining profile.
 * Returns { ok, store, removed, error }.
 */
export function deleteProfile(store, profileId) {
    if (store.profiles.length <= 1) {
        return { ok: false, store, removed: null, error: 'cannot delete the last profile' };
    }
    const removed = store.profiles.find((p) => p.id === profileId) || null;
    if (!removed) {
        return { ok: false, store, removed: null, error: 'profile not found' };
    }
    const profiles = store.profiles.filter((p) => p.id !== profileId);
    const activeProfileId = store.activeProfileId === profileId ? profiles[0].id : store.activeProfileId;
    return { ok: true, store: { ...store, profiles, activeProfileId }, removed, error: null };
}

export function switchProfile(store, profileId) {
    if (!store.profiles.some((p) => p.id === profileId)) {
        return { ok: false, store, error: 'profile not found' };
    }
    return { ok: true, store: { ...store, activeProfileId: profileId }, error: null };
}

/**
 * Export versioned JSON without secrets. Includes sourceCpuThreads for import re-resolve.
 */
export function exportDesktopStore(store, { sourceCpuThreads } = {}) {
    return {
        schemaVersion: 1,
        kind: 'xmrig-desktop-settings',
        exportedAt: new Date().toISOString(),
        sourceCpuThreads: sourceCpuThreads ?? null,
        activeProfileId: store.activeProfileId,
        profiles: stripSecrets(store).profiles
    };
}

/**
 * Preview import against current CPU count. Does not mutate storage.
 */
export function previewImport(raw, cpuThreads = 4) {
    if (!raw || typeof raw !== 'object') {
        return { ok: false, error: 'invalid JSON object', preview: null };
    }
    if (raw.kind && raw.kind !== 'xmrig-desktop-settings') {
        return { ok: false, error: `unexpected kind ${raw.kind}`, preview: null };
    }
    if (raw.schemaVersion != null && Number(raw.schemaVersion) > 1) {
        return { ok: false, error: `unsupported schemaVersion ${raw.schemaVersion}`, preview: null };
    }
    const normalized = normalizeDesktopStore(
        {
            schemaVersion: 1,
            activeProfileId: raw.activeProfileId,
            profiles: raw.profiles
        },
        cpuThreads
    );
    if (!normalized.ok) {
        return { ok: false, error: normalized.error, preview: null };
    }
    const sourceCpu = raw.sourceCpuThreads != null ? Number(raw.sourceCpuThreads) : null;
    const needsReresolve = [];
    for (const p of normalized.store.profiles) {
        const items = [];
        if (sourceCpu != null && sourceCpu !== cpuThreads && p.localOverrides?.threads) {
            items.push({
                field: 'threads',
                reason: `source had ${sourceCpu} logical CPUs; this host has ${cpuThreads}`,
                importedValue: p.threads
            });
        }
        if (Array.isArray(p.affinity) && p.affinity.length) {
            items.push({
                field: 'affinity',
                reason: 'affinity is host-local and must be re-resolved',
                importedValue: p.affinity
            });
        }
        if (items.length) {
            needsReresolve.push({ profileId: p.id, name: p.name, items });
        }
    }
    return {
        ok: true,
        error: null,
        preview: {
            profileCount: normalized.store.profiles.length,
            activeProfileId: normalized.store.activeProfileId,
            portableKeys: PORTABLE_KEYS,
            needsReresolve,
            store: normalized.store
        }
    };
}

/**
 * Apply a previously previewed import. Never auto-starts mining.
 */
export function applyImport(preview, storage = globalThis.localStorage) {
    if (!preview?.store) return { ok: false, error: 'no preview store' };
    const saved = saveDesktopStore(preview.store, storage);
    if (!saved.ok) return saved;
    return { ok: true, store: preview.store, autoStart: false };
}

function structuredCloneSafe(obj) {
    if (typeof structuredClone === 'function') return structuredClone(obj);
    return JSON.parse(JSON.stringify(obj));
}
