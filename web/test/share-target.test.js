/**
 * #25 regression + property checks for compact-target / share gate.
 * Run: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    checkDifficulty,
    checkShareAgainstTarget,
    decodeCompactTarget
} from '../js/share-target.js';
import {
    assertMoneroOceanPayoutAddress,
    assertWebCoinStartAllowed
} from '../js/engine-capabilities.js';

function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

function writeUint64LE(buf, offset, value) {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    view.setUint32(offset, Number(value & 0xffffffffn), true);
    view.setUint32(offset + 4, Number(value >> 32n), true);
}

const HASH_ISSUE =
    '0000000001000000000000000000000000000000000000000000000000000000';
const HASH_ZERO =
    '0000000000000000000000000000000000000000000000000000000000000000';

test('issue #25: three compact targets accept the documented hash', () => {
    for (const target of ['ffffffff', '01000000', '78563412']) {
        const r = checkShareAgainstTarget(hexToBytes(HASH_ISSUE), target);
        assert.equal(r.ok, true, target);
        assert.equal(r.meets, true, `should accept for ${target}`);
        assert.equal(checkDifficulty(hexToBytes(HASH_ISSUE), target), true);
    }
});

test('issue #25 baseline: zero hash vs ffffffff still passes', () => {
    const r = checkShareAgainstTarget(hexToBytes(HASH_ZERO), 'ffffffff');
    assert.equal(r.ok, true);
    assert.equal(r.meets, true);
});

test('32-bit decode matches XMRig UINT64_MAX/(UINT32_MAX/target32)', () => {
    const r = decodeCompactTarget('ffffffff');
    assert.equal(r.ok, true);
    assert.equal(r.target64, 0xffffffffffffffffn);
});

test('64-bit target hex (16 chars) is little-endian uint64', () => {
    const r = decodeCompactTarget('0100000000000000');
    assert.equal(r.ok, true);
    assert.equal(r.target64, 1n);
    const hash = new Uint8Array(32);
    assert.equal(checkShareAgainstTarget(hash, '0100000000000000').meets, true);
    hash[24] = 2;
    assert.equal(checkShareAgainstTarget(hash, '0100000000000000').meets, false);
});

test('rejects illegal targets', () => {
    assert.equal(decodeCompactTarget('').ok, false);
    assert.equal(decodeCompactTarget('abc').ok, false);
    assert.equal(decodeCompactTarget('00000000').ok, false);
    assert.equal(decodeCompactTarget('112233').ok, false);
    assert.equal(
        decodeCompactTarget('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff').ok,
        false
    );
});

test('does not mutate input hash buffer', () => {
    const hash = hexToBytes(HASH_ISSUE);
    const before = Uint8Array.from(hash);
    checkShareAgainstTarget(hash, 'ffffffff');
    assert.deepEqual(hash, before);
});

test('boundary: hash64 == target does not meet (strict <)', () => {
    const hash = new Uint8Array(32);
    const decoded = decodeCompactTarget('01000000');
    assert.equal(decoded.ok, true);
    writeUint64LE(hash, 24, decoded.target64);
    assert.equal(checkShareAgainstTarget(hash, '01000000').meets, false);
});

test('property: larger target64 accepts more hashes (monotonic)', () => {
    const easy = decodeCompactTarget('ffffffff');
    const hard = decodeCompactTarget('01000000');
    assert.ok(easy.target64 > hard.target64);
    const hash = hexToBytes(HASH_ISSUE);
    assert.equal(checkShareAgainstTarget(hash, 'ffffffff').meets, true);
    // HASH_ISSUE has hash64 = 0x0000000100000000 — may or may not meet hard target
    const hardMeet = checkShareAgainstTarget(hash, '01000000');
    assert.equal(hardMeet.ok, true);
    assert.equal(hardMeet.meets, true); // 0x100000000 < UINT64_MAX/(UINT32_MAX/1) = 0x100000001
});

test('property: round-trip LE bytes for 32-bit targets', () => {
    for (const hex of ['01000000', 'ffffffff', '78563412', 'abcdef01']) {
        const decoded = decodeCompactTarget(hex);
        assert.equal(decoded.ok, true, hex);
        const bytes = hexToBytes(hex);
        const target32 =
            BigInt(bytes[0]) |
            (BigInt(bytes[1]) << 8n) |
            (BigInt(bytes[2]) << 16n) |
            (BigInt(bytes[3]) << 24n);
        const expected = 0xffffffffffffffffn / (0xffffffffn / target32);
        assert.equal(decoded.target64, expected, hex);
    }
});

test('#26 capability gate blocks WOW and DERO on Web', () => {
    assert.equal(assertWebCoinStartAllowed('monero').allowed, true);
    assert.equal(assertWebCoinStartAllowed('wownero').allowed, false);
    assert.equal(assertWebCoinStartAllowed('dero').allowed, false);
});

test('#29 MoneroOcean requires Monero payout address', () => {
    const wowAddr = 'Wo' + 'a'.repeat(95);
    assert.equal(assertMoneroOceanPayoutAddress('moneroocean-wow', 'wownero', wowAddr).ok, false);
    assert.equal(assertMoneroOceanPayoutAddress('moneroocean', 'wownero', wowAddr).ok, false);
    const xmr = '4' + 'A'.repeat(94);
    assert.equal(assertMoneroOceanPayoutAddress('moneroocean', 'monero', xmr).ok, true);
    assert.equal(assertMoneroOceanPayoutAddress('supportxmr', 'monero', 'x').ok, true);
});
