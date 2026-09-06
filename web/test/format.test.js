import test from 'node:test';
import assert from 'node:assert/strict';

import {
    PLACEHOLDER,
    count,
    elideAddress,
    hashrate,
    hashrateText,
    shareSuccessRate,
    uptime
} from '../js/format.js';

test('hashrate formats SI steps', () => {
    assert.equal(hashrateText(12.34), '12.34 H/s');
    assert.equal(hashrateText(150.46), '150.5 H/s');
    assert.equal(hashrateText(1500), '1.50 kH/s');
    assert.equal(hashrateText(2_500_000), '2.50 MH/s');
});

test('hashrate while mining with no sample yet is pending, not zero', () => {
    const reading = hashrate(0, true);
    assert.equal(reading.quality, 'pending');
    assert.equal(reading.hasValue, false);
    assert.equal(reading.text, PLACEHOLDER);
});

test('hashrate while stopped is unavailable, not zero', () => {
    const reading = hashrate(0, false);
    assert.equal(reading.quality, 'unavailable');
    assert.equal(reading.text, PLACEHOLDER);
});

test('hashrate rejects NaN, Infinity, negatives and non-numbers', () => {
    for (const bad of [NaN, Infinity, -Infinity, -1, undefined, null, '42']) {
        assert.equal(hashrate(bad, false).hasValue, false, `${String(bad)} should not render`);
    }
});

test('hashrate reports a real measurement', () => {
    const reading = hashrate(42.5, true);
    assert.deepEqual(reading, { text: '42.50 H/s', quality: 'measured', hasValue: true });
});

test('success rate with no shares is unavailable, not 0.0%', () => {
    const reading = shareSuccessRate(0, 0);
    assert.equal(reading.quality, 'unavailable');
    assert.equal(reading.text, PLACEHOLDER);
});

test('success rate distinguishes all-rejected from no-data', () => {
    assert.equal(shareSuccessRate(0, 3).text, '0.0%');
    assert.equal(shareSuccessRate(3, 1).text, '75.0%');
    assert.equal(shareSuccessRate(5, 0).text, '100.0%');
});

test('success rate rejects negative and fractional counters', () => {
    assert.equal(shareSuccessRate(-1, 2).hasValue, false);
    assert.equal(shareSuccessRate(1.5, 2).hasValue, false);
});

test('uptime pads and grows past a day', () => {
    assert.equal(uptime(0).text, '0:00:00');
    assert.equal(uptime(65).text, '0:01:05');
    assert.equal(uptime(90_001).text, '25:00:01');
});

test('uptime rejects negatives and non-finite input', () => {
    assert.equal(uptime(-1).hasValue, false);
    assert.equal(uptime(NaN).hasValue, false);
});

test('count groups digits and refuses unknowns', () => {
    assert.equal(count(0), '0');
    assert.equal(count(1234567), '1,234,567');
    assert.equal(count(NaN), PLACEHOLDER);
    assert.equal(count(-3), PLACEHOLDER);
});

test('address elision keeps both ends and leaves short strings alone', () => {
    const addr = '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge';
    assert.equal(elideAddress(addr), '4AdUndXH…684Rge');
    assert.equal(elideAddress('short'), 'short');
    assert.equal(elideAddress(''), '');
    assert.equal(elideAddress(undefined), '');
});
