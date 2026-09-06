/**
 * Wallet address validation tests (#53).
 * Run: node --test shared/wallet-address/test/*.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAddressInput, validateWalletAddress } from '../js/validate.js';
import { keccak256 } from '../js/keccak256.js';

// Official Monero docs standard mainnet example
const OFFICIAL_STANDARD =
    '4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge';

test('keccak256 is NOT NIST SHA3 (padding differs)', () => {
    // Empty message Keccak-256 known vector
    const dig = keccak256(new Uint8Array(0));
    const hex = Buffer.from(dig).toString('hex');
    assert.equal(
        hex,
        'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'
    );
});

test('official Monero standard address validates mainnet', () => {
    const r = validateWalletAddress(OFFICIAL_STANDARD, 'monero');
    assert.equal(r.ok, true);
    assert.equal(r.network, 'mainnet');
    assert.equal(r.addressType, 'standard');
    assert.equal(r.normalized.length, 95);
});

test('single-char checksum mutation fails', () => {
    const chars = OFFICIAL_STANDARD.split('');
    // Flip a mid character within alphabet
    chars[40] = chars[40] === 'A' ? 'B' : 'A';
    const bad = chars.join('');
    const r = validateWalletAddress(bad, 'monero');
    assert.equal(r.ok, false);
    assert.ok(r.code === 'checksum' || r.code === 'base58' || r.code === 'network_byte');
});

test('truncated and oversized addresses fail', () => {
    assert.equal(validateWalletAddress(OFFICIAL_STANDARD.slice(0, 90), 'monero').ok, false);
    assert.equal(validateWalletAddress(OFFICIAL_STANDARD + 'abc', 'monero').ok, false);
});

test('illegal charset and unicode rejected', () => {
    assert.equal(validateWalletAddress('4' + 'O'.repeat(94), 'monero').code, 'charset'); // O not in alphabet
    assert.equal(validateWalletAddress(OFFICIAL_STANDARD + '\u200b', 'monero').ok, false);
});

test('wrong network rejected when only mainnet allowed', () => {
    // Synthesize would need valid testnet address; ensure classifier path exists via unknown byte fail
    const r = validateWalletAddress(OFFICIAL_STANDARD, 'monero', { networks: ['testnet'] });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'network');
});

test('legacy bug: 8+106 is NOT integrated — must fail without valid decode', () => {
    const fake = '8' + 'A'.repeat(105);
    const r = validateWalletAddress(fake, 'monero');
    assert.equal(r.ok, false);
});

test('subaddress prefix 8 length 95 still requires checksum', () => {
    const fake = '8' + '1'.repeat(94);
    const r = validateWalletAddress(fake, 'monero');
    assert.equal(r.ok, false);
});

test('parseAddressInput strips monero URI and ignores amount', () => {
    const p = parseAddressInput(`monero:${OFFICIAL_STANDARD}?tx_amount=1.0`);
    assert.equal(p.ok, true);
    assert.equal(p.address, OFFICIAL_STANDARD);
    assert.ok(p.warnings.some((w) => /query/i.test(w)));
    const v = validateWalletAddress(p.address, 'monero');
    assert.equal(v.ok, true);
});

test('URI with command-like params refused', () => {
    const p = parseAddressInput(`monero:${OFFICIAL_STANDARD}?start=1&pool=evil`);
    assert.equal(p.ok, false);
});

test('Wownero / DERO format gates without inventing checksum', () => {
    const wow = validateWalletAddress('Wo' + '1'.repeat(95), 'wownero');
    assert.equal(wow.ok, true);
    assert.equal(wow.code, 'format_only');
    const dero = validateWalletAddress('dero1' + 'q'.repeat(60), 'dero');
    assert.equal(dero.ok, true);
    assert.equal(dero.code, 'format_only');
    assert.equal(validateWalletAddress('bad', 'wownero').ok, false);
});

test('empty address fails clearly', () => {
    const r = validateWalletAddress('   ', 'monero');
    assert.equal(r.ok, false);
    assert.equal(r.code, 'empty');
});
