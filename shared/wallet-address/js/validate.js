/**
 * Cross-platform wallet address validation (#53).
 * Monero uses Keccak checksum (not SHA3). Checksum pass ≠ ownership proof.
 */

import { cnBase58Decode } from './cn-base58.js';
import { keccak256 } from './keccak256.js';

/** Mainnet / testnet / stagenet netbytes (Monero). */
export const MONERO_NETBYTES = {
    standard: { mainnet: 0x12, testnet: 0x35, stagenet: 0x18 },
    integrated: { mainnet: 0x13, testnet: 0x36, stagenet: 0x19 },
    subaddress: { mainnet: 0x2a, testnet: 0x3f, stagenet: 0x24 }
};

/**
 * @typedef {object} ValidateResult
 * @property {boolean} ok
 * @property {string} [code]
 * @property {string} [message]
 * @property {string} [coin]
 * @property {string} [network]
 * @property {string} [addressType]
 * @property {string} [normalized]
 */

/**
 * @param {string} address
 * @param {'monero'|'wownero'|'dero'|string} coin
 * @param {{ networks?: ('mainnet'|'testnet'|'stagenet')[], allowIntegrated?: boolean }} [opts]
 * @returns {ValidateResult}
 */
export function validateWalletAddress(address, coin = 'monero', opts = {}) {
    const raw = typeof address === 'string' ? address.trim() : '';
    if (!raw) {
        return fail('empty', 'Wallet address is required');
    }
    if (/[\u0000-\u001f\u007f]/.test(raw)) {
        return fail('illegal_char', 'Address contains control characters');
    }
    // NFC normalize then reject if still has combining marks / fullwidth lookalikes
    const normalized = raw.normalize('NFC');
    if (normalized !== raw) {
        return fail('unicode_normalize', 'Address must be plain ASCII Base58 / bech-style text');
    }
    if (/[^\x20-\x7E]/.test(raw)) {
        return fail('unicode', 'Address contains non-ASCII characters');
    }

    const c = String(coin || 'monero').toLowerCase();
    if (c === 'monero' || c === 'xmr') return validateMonero(raw, opts);
    if (c === 'wownero' || c === 'wow') return validateWownero(raw);
    if (c === 'dero') return validateDero(raw);
    return fail('unsupported_coin', `Unsupported coin "${coin}"`);
}

/**
 * Safe paste preview — never auto-start mining; strip monero: URI wrappers.
 * @param {string} text
 */
export function parseAddressInput(text) {
    const raw = String(text || '').trim();
    if (!raw) return { ok: false, address: '', uri: null, warnings: ['empty'] };

    let address = raw;
    let uri = null;
    const warnings = [];

    // monero:ADDR[?tx_amount=...]
    const m = raw.match(/^(monero|wownero|dero):([^?/\s]+)(\?.*)?$/i);
    if (m) {
        uri = {
            scheme: m[1].toLowerCase(),
            query: m[3] || ''
        };
        address = m[2];
        if (uri.query) {
            warnings.push('URI query ignored — review amount/params before mining; never auto-start');
        }
        // Reject command-like query keys
        if (/[;&]|start=|donate=|pool=/i.test(uri.query)) {
            return {
                ok: false,
                address: '',
                uri,
                warnings: ['URI contains disallowed parameters — paste address only']
            };
        }
    }

    return { ok: true, address, uri, warnings };
}

function validateMonero(address, opts) {
    const networks = opts.networks || ['mainnet'];
    const allowIntegrated = opts.allowIntegrated !== false;

    if (!/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/.test(address)) {
        return fail('charset', 'Monero address has illegal Base58 characters', 'monero');
    }

    const expectedLens = allowIntegrated ? [95, 106] : [95];
    if (!expectedLens.includes(address.length)) {
        if (address.length === 106 && !allowIntegrated) {
            return fail('integrated_disabled', 'Integrated addresses are not enabled for this entry', 'monero');
        }
        return fail(
            'length',
            `Monero address length ${address.length} invalid (expect 95 standard/subaddress` +
                (allowIntegrated ? ', 106 integrated' : '') +
                ')',
            'monero'
        );
    }

    const bytes = cnBase58Decode(address);
    if (!bytes) {
        return fail('base58', 'Monero Base58 decode failed', 'monero');
    }

    const expectDecoded = address.length === 95 ? 69 : 77;
    if (bytes.length !== expectDecoded) {
        return fail('decoded_length', `Decoded length ${bytes.length} ≠ ${expectDecoded}`, 'monero');
    }

    const payload = bytes.subarray(0, bytes.length - 4);
    const checksum = bytes.subarray(bytes.length - 4);
    const hash = keccak256(payload);
    for (let i = 0; i < 4; i++) {
        if (hash[i] !== checksum[i]) {
            return fail('checksum', 'Monero checksum mismatch (typo or truncated address)', 'monero');
        }
    }

    const netbyte = bytes[0];
    const classified = classifyMoneroNetbyte(netbyte);
    if (!classified) {
        return fail('network_byte', `Unknown Monero network byte 0x${netbyte.toString(16)}`, 'monero');
    }
    if (!networks.includes(classified.network)) {
        return fail(
            'network',
            `Address is ${classified.network} ${classified.addressType}; allowed: ${networks.join(',')}`,
            'monero',
            classified
        );
    }
    if (classified.addressType === 'integrated' && !allowIntegrated) {
        return fail('integrated_disabled', 'Integrated addresses are not enabled', 'monero', classified);
    }

    return {
        ok: true,
        coin: 'monero',
        network: classified.network,
        addressType: classified.addressType,
        normalized: address,
        code: 'ok',
        message: `${classified.network} ${classified.addressType} address`
    };
}

function classifyMoneroNetbyte(b) {
    for (const [addressType, nets] of Object.entries(MONERO_NETBYTES)) {
        for (const [network, byte] of Object.entries(nets)) {
            if (byte === b) return { addressType, network };
        }
    }
    return null;
}

function validateWownero(address) {
    // Wownero is Cryptonote-family with "Wo" prefix; full checksum vectors not bundled yet.
    if (!address.startsWith('Wo')) {
        return fail('prefix', 'Wownero address must start with Wo', 'wownero');
    }
    if (address.length < 95 || address.length > 106) {
        return fail('length', 'Wownero address length out of range', 'wownero');
    }
    if (!/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/.test(address)) {
        return fail('charset', 'Wownero address has illegal characters', 'wownero');
    }
    return {
        ok: true,
        coin: 'wownero',
        network: 'mainnet',
        addressType: 'standard',
        normalized: address,
        code: 'format_only',
        message: 'Wownero format OK (prefix/length/charset); Keccak checksum vectors not asserted in this build'
    };
}

function validateDero(address) {
    // DERO uses bech32-style dero1... — do not invent checksum here.
    const lower = address.toLowerCase();
    if (!lower.startsWith('dero1') && !lower.startsWith('dero')) {
        return fail('prefix', 'DERO address must start with dero', 'dero');
    }
    if (address.length < 60) {
        return fail('length', 'DERO address too short', 'dero');
    }
    if (!/^[0-9a-zA-Z]+$/.test(address)) {
        return fail('charset', 'DERO address has illegal characters', 'dero');
    }
    return {
        ok: true,
        coin: 'dero',
        network: 'mainnet',
        addressType: 'standard',
        normalized: address,
        code: 'format_only',
        message: 'DERO format OK; full bech32 checksum not asserted in this build'
    };
}

function fail(code, message, coin, extra = {}) {
    return { ok: false, code, message, coin, ...extra };
}
