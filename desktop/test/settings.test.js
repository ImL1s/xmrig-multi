import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DESKTOP_SETTINGS_KEY,
    applyImport,
    createProfile,
    deleteProfile,
    duplicateProfile,
    exportDesktopStore,
    getActiveProfile,
    loadDesktopStore,
    normalizeDesktopStore,
    previewImport,
    renameProfile,
    saveDesktopStore,
    switchProfile
} from '../src/settings.js';

function memoryStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); }
    };
}

test('#46 restore keeps manual threads instead of N-1 default', () => {
    const storage = memoryStorage();
    const store = {
        schemaVersion: 1,
        activeProfileId: 'default',
        profiles: [{
            id: 'default',
            name: 'Default',
            coin_type: 'monero',
            pool_url: 'pool.supportxmr.com:3333',
            custom_pool_url: '',
            use_custom_pool: false,
            wallet_address: '4AAA',
            worker_name: 'rig1',
            threads: 3,
            algorithm: 'rx/0'
        }]
    };
    saveDesktopStore(store, storage);
    const loaded = loadDesktopStore(storage, 16);
    assert.equal(getActiveProfile(loaded.store).threads, 3);
    assert.equal(getActiveProfile(loaded.store).wallet_address, '4AAA');
});

test('#46 strips password/token/secret on save', () => {
    const storage = memoryStorage();
    saveDesktopStore({
        schemaVersion: 1,
        activeProfileId: 'default',
        profiles: [{
            id: 'default',
            name: 'Default',
            coin_type: 'monero',
            pool_url: 'x',
            wallet_address: 'w',
            worker_name: 'd',
            threads: 2,
            algorithm: 'rx/0',
            password: 'secret',
            token: 't',
            secret: 's'
        }]
    }, storage);
    const raw = JSON.parse(storage.getItem(DESKTOP_SETTINGS_KEY));
    assert.equal(raw.profiles[0].password, undefined);
    assert.equal(raw.profiles[0].token, undefined);
});

test('#46 corrupt store falls back', () => {
    const r = normalizeDesktopStore(null, 8);
    assert.equal(r.ok, false);
    assert.ok(r.store.profiles.length >= 1);
});

test('#46 create duplicate rename switch delete profiles', () => {
    let store = normalizeDesktopStore({
        schemaVersion: 1,
        activeProfileId: 'default',
        profiles: [{
            id: 'default',
            name: 'Default',
            coin_type: 'monero',
            pool_url: 'pool.supportxmr.com:3333',
            wallet_address: '4A',
            worker_name: 'd',
            threads: 2,
            algorithm: 'rx/0'
        }]
    }, 8).store;

    const created = createProfile(store, 8, 'Night');
    store = created.store;
    assert.equal(store.profiles.length, 2);
    assert.equal(store.activeProfileId, created.profile.id);

    const dup = duplicateProfile(store, 'default', 8);
    store = dup.store;
    assert.equal(store.profiles.length, 3);
    assert.match(dup.profile.name, /copy$/i);

    store = renameProfile(store, created.profile.id, '  Quiet  ');
    assert.equal(store.profiles.find((p) => p.id === created.profile.id).name, 'Quiet');

    const switched = switchProfile(store, 'default');
    assert.equal(switched.ok, true);
    store = switched.store;
    assert.equal(store.activeProfileId, 'default');

    const del = deleteProfile(store, created.profile.id);
    assert.equal(del.ok, true);
    store = del.store;
    assert.equal(store.profiles.some((p) => p.id === created.profile.id), false);

    const last = deleteProfile({ ...store, profiles: [store.profiles[0]], activeProfileId: store.profiles[0].id }, store.profiles[0].id);
    assert.equal(last.ok, false);
});

test('#46 export/import preview flags threads re-resolve on CPU mismatch', () => {
    const store = normalizeDesktopStore({
        schemaVersion: 1,
        activeProfileId: 'default',
        profiles: [{
            id: 'default',
            name: 'Default',
            coin_type: 'monero',
            pool_url: 'custom.example:3333',
            custom_pool_url: 'custom.example:3333',
            use_custom_pool: true,
            wallet_address: '4ABC',
            worker_name: 'desk',
            threads: 12,
            algorithm: 'rx/0',
            localOverrides: { threads: true }
        }]
    }, 16).store;

    const exported = exportDesktopStore(store, { sourceCpuThreads: 16 });
    assert.equal(exported.kind, 'xmrig-desktop-settings');
    assert.equal(exported.profiles[0].password, undefined);

    const preview = previewImport(exported, 4);
    assert.equal(preview.ok, true);
    assert.equal(preview.preview.profileCount, 1);
    assert.ok(preview.preview.needsReresolve.length >= 1);
    assert.equal(preview.preview.needsReresolve[0].items[0].field, 'threads');
    // Portable wallet/custom endpoint preserved after clamp
    assert.equal(preview.preview.store.profiles[0].wallet_address, '4ABC');
    assert.equal(preview.preview.store.profiles[0].use_custom_pool, true);
    assert.equal(preview.preview.store.profiles[0].threads, 4);

    const storage = memoryStorage();
    const applied = applyImport(preview.preview, storage);
    assert.equal(applied.ok, true);
    assert.equal(applied.autoStart, false);
    const loaded = loadDesktopStore(storage, 4);
    assert.equal(getActiveProfile(loaded.store).wallet_address, '4ABC');
});

test('#46 future schemaVersion is refused', () => {
    const r = normalizeDesktopStore({ schemaVersion: 99, profiles: [{ id: 'x', name: 'x', threads: 1 }] }, 4);
    assert.equal(r.ok, false);
    assert.match(r.error, /schemaVersion/);
});
