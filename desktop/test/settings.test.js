import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DESKTOP_SETTINGS_KEY,
    getActiveProfile,
    loadDesktopStore,
    normalizeDesktopStore,
    saveDesktopStore
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
