/**
 * Cryptonote / Monero Base58 (block encoding) (#53).
 * Alphabet matches Bitcoin Base58 but encoding is 8-byte blocks → 11 chars.
 */

export const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const FULL_BLOCK_SIZE = 8;
const FULL_ENCODED_BLOCK_SIZE = 11;
const DECODED_BLOCK_SIZES = [0, 2, 3, 5, 6, 7, 9, 10, 11];

/**
 * @param {string} str
 * @returns {Uint8Array|null}
 */
export function cnBase58Decode(str) {
    if (typeof str !== 'string' || !str.length) return null;
    for (const ch of str) {
        if (ALPHABET.indexOf(ch) < 0) return null;
    }

    const fullBlockCount = Math.floor(str.length / FULL_ENCODED_BLOCK_SIZE);
    const lastBlockSize = str.length % FULL_ENCODED_BLOCK_SIZE;
    const lastDecodedSize = DECODED_BLOCK_SIZES.indexOf(lastBlockSize);
    if (lastBlockSize > 0 && lastDecodedSize < 0) return null;

    const dataLen = fullBlockCount * FULL_BLOCK_SIZE + (lastBlockSize > 0 ? lastDecodedSize : 0);
    const data = new Uint8Array(dataLen);
    for (let i = 0; i < fullBlockCount; i++) {
        const enc = str.slice(i * FULL_ENCODED_BLOCK_SIZE, (i + 1) * FULL_ENCODED_BLOCK_SIZE);
        const dec = decodeBlock(enc, FULL_BLOCK_SIZE);
        if (!dec) return null;
        data.set(dec, i * FULL_BLOCK_SIZE);
    }
    if (lastBlockSize > 0) {
        const enc = str.slice(fullBlockCount * FULL_ENCODED_BLOCK_SIZE);
        const dec = decodeBlock(enc, lastDecodedSize);
        if (!dec) return null;
        data.set(dec, fullBlockCount * FULL_BLOCK_SIZE);
    }
    return data;
}

function decodeBlock(enc, decodedSize) {
    let num = 0n;
    for (let i = 0; i < enc.length; i++) {
        const digit = BigInt(ALPHABET.indexOf(enc[i]));
        if (digit < 0n) return null;
        num = num * 58n + digit;
    }
    const out = new Uint8Array(decodedSize);
    for (let i = decodedSize - 1; i >= 0; i--) {
        out[i] = Number(num & 0xffn);
        num >>= 8n;
    }
    if (num !== 0n) return null;
    return out;
}
