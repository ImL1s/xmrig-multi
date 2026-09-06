/**
 * i18n catalog tests (#59).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    STATUS,
    t,
    formatHashrate,
    formatBytesMiB,
    protocolNumber,
    localizeUiOnly
} from '../js/catalog.js';

test('status codes exist in en and zh-Hant', () => {
    for (const key of Object.keys(STATUS)) {
        assert.equal(t(key, 'en').missing, false);
        assert.equal(t(key, 'zh-Hant').missing, false);
        assert.ok(t(key, 'zh-Hant').text.length > 0);
    }
    assert.equal(t('paused_thermal', 'zh-Hant').text, '因過熱暫停');
    assert.equal(t('connecting', 'en').text, 'Connecting');
});

test('unknown hashrate is never formatted as 0', () => {
    assert.equal(formatHashrate(null).unknown, true);
    assert.doesNotMatch(formatHashrate(null).text, /^0/);
    assert.equal(formatHashrate(Number.NaN).unknown, true);
    assert.equal(formatHashrate(undefined).unknown, true);
    assert.equal(formatHashrate(-1).unknown, true);
    assert.equal(formatHashrate(0).unknown, false);
    assert.equal(formatHashrate(0).unit, 'H/s');
    assert.equal(formatHashrate(1500).unit, 'kH/s');
    assert.equal(formatHashrate(2e6).unit, 'MH/s');
});

test('MiB/GiB binary units', () => {
    assert.equal(formatBytesMiB(null).unknown, true);
    assert.equal(formatBytesMiB(512).unit, 'MiB');
    assert.equal(formatBytesMiB(2048).unit, 'GiB');
});

test('protocolNumber never uses locale grouping', () => {
    assert.equal(protocolNumber(12345.5), '12345.5');
    assert.equal(protocolNumber(null), null);
});

test('locale switch preserves algorithm and endpoint', () => {
    const next = localizeUiOnly(
        { algorithm: 'rx/0', endpoint: 'pool:3333', draft: { threads: 2 }, locale: 'en' },
        'zh-Hant'
    );
    assert.equal(next.locale, 'zh-Hant');
    assert.equal(next.algorithm, 'rx/0');
    assert.equal(next.endpoint, 'pool:3333');
    assert.equal(next.draft.threads, 2);
});
