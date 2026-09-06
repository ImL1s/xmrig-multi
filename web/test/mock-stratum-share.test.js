/**
 * Offline mock Stratum share gate (#25 / #64 harness slice).
 * Does not connect to a public pool. Validates login→job→submit decision
 * uses checkShareAgainstTarget (accepted only when hash meets compact target).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkShareAgainstTarget } from '../js/share-target.js';

function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

/** Minimal in-memory pool: accepts submit iff share gate passes. */
function mockPoolAccept(jobTarget, resultHex) {
    const hash = hexToBytes(resultHex);
    const gate = checkShareAgainstTarget(hash, jobTarget);
    if (!gate.ok) {
        return { accepted: false, error: gate.error };
    }
    return { accepted: gate.meets, error: gate.meets ? null : 'low difficulty share' };
}

test('mock stratum: valid share increases accepted, not merely hash count', () => {
    const session = { accepted: 0, rejected: 0, hashes: 0 };
    const job = { id: '1', target: 'ffffffff' };
    const goodHash =
        '0000000001000000000000000000000000000000000000000000000000000000';

    session.hashes += 1;
    const r = mockPoolAccept(job.target, goodHash);
    if (r.accepted) session.accepted += 1;
    else session.rejected += 1;

    assert.equal(session.hashes, 1);
    assert.equal(session.accepted, 1);
    assert.equal(session.rejected, 0);
});

test('mock stratum: failing share is rejected without counting as accepted', () => {
    const session = { accepted: 0, rejected: 0 };
    // target64 = 1; hash64 at offset 24 = 2 → reject
    const hash = new Uint8Array(32);
    hash[24] = 2;
    const hex = Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
    const r = mockPoolAccept('0100000000000000', hex);
    assert.equal(r.accepted, false);
    if (r.accepted) session.accepted += 1;
    else session.rejected += 1;
    assert.equal(session.accepted, 0);
    assert.equal(session.rejected, 1);
});

test('mock stratum: illegal target is protocol error, not silent pad', () => {
    const r = mockPoolAccept('abc', '00'.repeat(32));
    assert.equal(r.accepted, false);
    assert.match(r.error, /hex|even|target/i);
});
