/**
 * XMRig-compatible Stratum compact-target decode + share check.
 * Mirrors xmrig Job::setTarget + CpuWorker hash compare
 * (hash[24..32] as LE uint64 < m_target). Upstream: xmrig v6.21.0.
 */

const UINT32_MAX = 0xffffffffn;
const UINT64_MAX = 0xffffffffffffffffn;

/**
 * @param {string} targetHex
 * @returns {{ ok: true, target64: bigint } | { ok: false, error: string }}
 */
export function decodeCompactTarget(targetHex) {
    if (targetHex == null || typeof targetHex !== 'string') {
        return { ok: false, error: 'target missing' };
    }
    const hex = targetHex.trim().toLowerCase();
    if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) {
        return { ok: false, error: 'target must be even-length hex' };
    }
    const bytes = hexToBytes(hex);
    if (bytes.length === 4) {
        const target32 = readUint32LE(bytes, 0);
        if (target32 === 0n) {
            return { ok: false, error: 'zero 32-bit target' };
        }
        // Job::setTarget: UINT64_MAX / (UINT32_MAX / target32)
        const target64 = UINT64_MAX / (UINT32_MAX / target32);
        return { ok: true, target64 };
    }
    if (bytes.length === 8) {
        const target64 = readUint64LE(bytes, 0);
        if (target64 === 0n) {
            return { ok: false, error: 'zero 64-bit target' };
        }
        return { ok: true, target64 };
    }
    return { ok: false, error: `unsupported target length ${bytes.length} bytes (need 4 or 8)` };
}

/**
 * @param {Uint8Array} hash 32-byte RandomX digest (not mutated)
 * @param {string} targetHex
 * @returns {{ ok: true, meets: boolean, target64: bigint, hash64: bigint } | { ok: false, error: string }}
 */
export function checkShareAgainstTarget(hash, targetHex) {
    if (!(hash instanceof Uint8Array) || hash.length < 32) {
        return { ok: false, error: 'hash must be Uint8Array of length >= 32' };
    }
    const decoded = decodeCompactTarget(targetHex);
    if (!decoded.ok) {
        return decoded;
    }
    const hash64 = readUint64LE(hash, 24);
    return {
        ok: true,
        meets: hash64 < decoded.target64,
        target64: decoded.target64,
        hash64
    };
}

/** Convenience boolean for the mining worker. */
export function checkDifficulty(hash, targetHex) {
    const result = checkShareAgainstTarget(hash, targetHex);
    return result.ok && result.meets;
}

function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

function readUint32LE(bytes, offset) {
    return (
        BigInt(bytes[offset]) |
        (BigInt(bytes[offset + 1]) << 8n) |
        (BigInt(bytes[offset + 2]) << 16n) |
        (BigInt(bytes[offset + 3]) << 24n)
    );
}

function readUint64LE(bytes, offset) {
    const lo = readUint32LE(bytes, offset);
    const hi = readUint32LE(bytes, offset + 4);
    return lo + (hi << 32n);
}
