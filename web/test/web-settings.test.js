import test from 'node:test';
import assert from 'node:assert/strict';
import {
    loadWebSettingsFromStorage,
    normalizeWebSettings,
    saveWebSettingsToStorage
} from '../js/web-settings.js';

function memoryStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); }
    };
}

test('#47 normalize preserves threads within core count', () => {
    const r = normalizeWebSettings({ threads: 3, coinSelect: 'monero' }, { cores: 8 });
    assert.equal(r.ok, true);
    assert.equal(r.settings.threads, 3);
});

test('#47 clamps threads above hardwareConcurrency with warning', () => {
    const r = normalizeWebSettings({ threads: 16 }, { cores: 4 });
    assert.equal(r.settings.threads, 4);
    assert.equal(r.settings.requestedThreads, 16);
    assert.ok(r.warnings.length > 0);
});

test('#47 malformed JSON falls back without throwing', () => {
    const storage = memoryStorage({ xmrig_web_settings: '{not-json' });
    const r = loadWebSettingsFromStorage(storage, { cores: 4 });
    assert.equal(r.ok, false);
    assert.equal(r.settings.threads >= 1, true);
});

test('#47 array payload rejected', () => {
    const r = normalizeWebSettings([1, 2, 3], { cores: 4 });
    assert.equal(r.ok, false);
});

test('#47 save round-trip', () => {
    const storage = memoryStorage();
    const saved = saveWebSettingsToStorage({ threads: 2, coinSelect: 'monero' }, storage);
    assert.equal(saved.ok, true);
    const loaded = loadWebSettingsFromStorage(storage, { cores: 8 });
    assert.equal(loaded.settings.threads, 2);
});
