/**
 * Compact Keccak-256 (original padding — NOT NIST SHA3).
 * Required for Monero address checksums (#53).
 * Port of the public-domain tiny keccak used in Cryptonote tooling.
 */

const RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an,
    0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
    0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an,
    0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
    0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
    0x000000000000800an, 0x800000008000000an, 0x8000000080008081n,
    0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
];

const ROTC = [
    1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14,
    27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44
];

const PILN = [
    10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4,
    15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1
];

function rotl64(x, n) {
    return ((x << BigInt(n)) | (x >> (64n - BigInt(n)))) & 0xffffffffffffffffn;
}

/**
 * @param {Uint8Array} message
 * @returns {Uint8Array} 32-byte digest
 */
export function keccak256(message) {
    const s = new Array(25).fill(0n);
    const rate = 136; // 1088-bit rate for keccak256
    let offset = 0;
    const msg = message instanceof Uint8Array ? message : new Uint8Array(message);

    while (offset + rate <= msg.length) {
        absorb(s, msg.subarray(offset, offset + rate));
        keccakF(s);
        offset += rate;
    }

    const block = new Uint8Array(rate);
    const rem = msg.length - offset;
    block.set(msg.subarray(offset));
    block[rem] = 0x01; // keccak pad (not SHA3 0x06)
    block[rate - 1] |= 0x80;
    absorb(s, block);
    keccakF(s);

    const out = new Uint8Array(32);
    for (let i = 0; i < 4; i++) {
        const v = s[i];
        for (let j = 0; j < 8; j++) {
            out[i * 8 + j] = Number((v >> BigInt(8 * j)) & 0xffn);
        }
    }
    return out;
}

function absorb(s, block) {
    for (let i = 0; i < block.length; i += 8) {
        let x = 0n;
        for (let j = 0; j < 8; j++) {
            x |= BigInt(block[i + j]) << BigInt(8 * j);
        }
        s[i / 8] ^= x;
    }
}

function keccakF(s) {
    for (let round = 0; round < 24; round++) {
        const bc = new Array(5);
        for (let i = 0; i < 5; i++) {
            bc[i] = s[i] ^ s[i + 5] ^ s[i + 10] ^ s[i + 15] ^ s[i + 20];
        }
        for (let i = 0; i < 5; i++) {
            const t = bc[(i + 4) % 5] ^ rotl64(bc[(i + 1) % 5], 1);
            for (let j = 0; j < 25; j += 5) s[j + i] ^= t;
        }
        let t = s[1];
        for (let i = 0; i < 24; i++) {
            const j = PILN[i];
            const tmp = s[j];
            s[j] = rotl64(t, ROTC[i]);
            t = tmp;
        }
        for (let j = 0; j < 25; j += 5) {
            for (let i = 0; i < 5; i++) bc[i] = s[j + i];
            for (let i = 0; i < 5; i++) {
                s[j + i] ^= (~bc[(i + 1) % 5]) & bc[(i + 2) % 5];
            }
        }
        s[0] ^= RC[round];
    }
}
