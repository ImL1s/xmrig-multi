/**
 * Affinity parse / validate / normalize (#36).
 * Supports CPU-id lists and multi-word hex masks (not limited to 32-bit).
 */

/**
 * @param {object} snapshot HardwareSnapshot-like
 * @returns {{ logicalMax: number, allowedIds: number[]|null, onlineIds: number[] }}
 */
export function allowedUniverse(snapshot) {
    const logical = Number(snapshot?.cpu?.logical?.value);
    const allowedCount = Number(snapshot?.cpu?.allowed?.value);
    const groups = snapshot?.cpu?.coreGroups?.value;
    const fromGroups = [];
    if (Array.isArray(groups)) {
        for (const g of groups) {
            for (const id of g?.logicalIds || []) {
                if (Number.isInteger(id)) fromGroups.push(id);
            }
        }
    }
    const logicalMax = Number.isInteger(logical) && logical >= 1
        ? logical
        : (fromGroups.length ? Math.max(...fromGroups) + 1 : 1);

    let onlineIds = [...new Set(fromGroups)].sort((a, b) => a - b);
    if (!onlineIds.length) {
        const n = Number.isInteger(allowedCount) && allowedCount >= 1
            ? Math.min(allowedCount, logicalMax)
            : logicalMax;
        onlineIds = Array.from({ length: n }, (_, i) => i);
    }

    /** @type {number[]|null} */
    let allowedIds = null;
    if (Number.isInteger(allowedCount) && allowedCount >= 1 && allowedCount < logicalMax && !fromGroups.length) {
        // cpuset-style: first N of logical space when groups unknown
        allowedIds = Array.from({ length: allowedCount }, (_, i) => i);
    } else if (fromGroups.length && Number.isInteger(allowedCount) && allowedCount < fromGroups.length) {
        allowedIds = onlineIds.slice(0, allowedCount);
    } else {
        allowedIds = onlineIds;
    }

    return { logicalMax, allowedIds, onlineIds };
}

/**
 * Parse "0,2,4-7" / "0 2 4" / ["0","2"] into sorted unique ids.
 * @param {string|number[]|null|undefined} input
 * @returns {{ ok: boolean, ids: number[], errors: string[] }}
 */
export function parseCpuIdList(input) {
    if (input == null || input === '') {
        return { ok: false, ids: [], errors: ['empty affinity'] };
    }
    if (Array.isArray(input)) {
        const ids = [];
        const errors = [];
        for (const raw of input) {
            const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
            if (!Number.isInteger(n)) errors.push(`non-integer id: ${raw}`);
            else ids.push(n);
        }
        if (errors.length) return { ok: false, ids: [], errors };
        return normalizeIdList(ids);
    }
    const text = String(input).trim();
    if (/^0x[0-9a-fA-F_]+$/.test(text) || /^[0-9a-fA-F]+h$/i.test(text)) {
        return maskToIds(text);
    }
    const ids = [];
    const errors = [];
    const parts = text.split(/[,\s]+/).filter(Boolean);
    for (const part of parts) {
        const range = part.match(/^(\d+)-(\d+)$/);
        if (range) {
            const a = Number(range[1]);
            const b = Number(range[2]);
            if (a > b) {
                errors.push(`inverted range: ${part}`);
                continue;
            }
            if (b - a > 4096) {
                errors.push(`range too large: ${part}`);
                continue;
            }
            for (let i = a; i <= b; i++) ids.push(i);
            continue;
        }
        if (!/^\d+$/.test(part)) {
            errors.push(`invalid token: ${part}`);
            continue;
        }
        ids.push(Number(part));
    }
    if (errors.length) return { ok: false, ids: [], errors };
    return normalizeIdList(ids);
}

/**
 * Multi-word hex mask → CPU ids (word0 = CPUs 0-63, word1 = 64-127, ...).
 * Accepts 0xAA_BB or 0xAABB,CCDD (comma-separated words, low word first).
 * @param {string} mask
 */
export function maskToIds(mask) {
    let raw = String(mask).trim();
    if (/h$/i.test(raw)) raw = raw.slice(0, -1);
    if (raw.startsWith('0x') || raw.startsWith('0X')) raw = raw.slice(2);
    const words = raw.includes(',')
        ? raw.split(',').map((w) => w.replace(/_/g, '').trim())
        : [raw.replace(/_/g, '')];
    const ids = [];
    const errors = [];
    for (let wi = 0; wi < words.length; wi++) {
        const w = words[wi];
        if (!/^[0-9a-fA-F]+$/.test(w)) {
            errors.push(`bad mask word: ${w}`);
            continue;
        }
        // BigInt for >64-bit single word; process bit by bit up to 256 bits/word max
        let value;
        try {
            value = BigInt(`0x${w}`);
        } catch {
            errors.push(`mask parse failed: ${w}`);
            continue;
        }
        const base = wi * 64;
        for (let bit = 0; bit < 256; bit++) {
            if (((value >> BigInt(bit)) & 1n) === 1n) ids.push(base + bit);
        }
    }
    if (errors.length) return { ok: false, ids: [], errors };
    return normalizeIdList(ids);
}

/**
 * @param {number[]} ids
 */
export function normalizeIdList(ids) {
    if (!ids.length) return { ok: false, ids: [], errors: ['empty affinity after parse'] };
    const seen = new Set();
    const out = [];
    const errors = [];
    for (const id of ids) {
        if (!Number.isInteger(id) || id < 0) {
            errors.push(`invalid id: ${id}`);
            continue;
        }
        if (id > 65535) {
            errors.push(`id overflow: ${id}`);
            continue;
        }
        if (seen.has(id)) continue; // drop duplicates quietly after note
        seen.add(id);
        out.push(id);
    }
    out.sort((a, b) => a - b);
    if (errors.length) return { ok: false, ids: [], errors };
    if (!out.length) return { ok: false, ids: [], errors: ['empty after dedupe'] };
    const hadDupes = ids.length !== out.length;
    return {
        ok: true,
        ids: out,
        errors: [],
        warnings: hadDupes ? ['duplicate cpu ids removed'] : []
    };
}

/**
 * Validate requested affinity against snapshot universe.
 * @param {object} snapshot
 * @param {string|number[]|null} input
 * @param {{ allowNormalize?: boolean }} [opts]
 */
export function validateAffinity(snapshot, input, opts = {}) {
    const allowNormalize = opts.allowNormalize !== false;
    const parsed = parseCpuIdList(input);
    if (!parsed.ok) {
        return {
            ok: false,
            ids: [],
            rejected: true,
            errors: parsed.errors,
            warnings: [],
            normalized: false
        };
    }
    const { logicalMax, allowedIds, onlineIds } = allowedUniverse(snapshot);
    const allowedSet = new Set(allowedIds || onlineIds);
    const onlineSet = new Set(onlineIds);
    const errors = [];
    const warnings = [...(parsed.warnings || [])];
    const kept = [];
    for (const id of parsed.ids) {
        if (id >= logicalMax) {
            errors.push(`id ${id} out of range (logicalMax=${logicalMax})`);
            continue;
        }
        if (!onlineSet.has(id) && onlineIds.length === logicalMax) {
            // dense 0..n-1 universe — offline means out of online set when sparse groups exist
        }
        if (onlineIds.length && !onlineSet.has(id) && Array.isArray(snapshot?.cpu?.coreGroups?.value)) {
            errors.push(`cpu ${id} offline / not in topology`);
            continue;
        }
        if (!allowedSet.has(id)) {
            errors.push(`cpu ${id} outside allowed cpuset`);
            continue;
        }
        kept.push(id);
    }
    if (!kept.length) {
        return {
            ok: false,
            ids: [],
            rejected: true,
            errors: errors.length ? errors : ['no valid cpu ids'],
            warnings,
            normalized: false
        };
    }
    if (errors.length && !allowNormalize) {
        return { ok: false, ids: [], rejected: true, errors, warnings, normalized: false };
    }
    if (errors.length && allowNormalize) {
        warnings.push(`normalized: dropped invalid ids (${errors.join('; ')})`);
        return { ok: true, ids: kept, rejected: false, errors: [], warnings, normalized: true };
    }
    return { ok: true, ids: kept, rejected: false, errors: [], warnings, normalized: false };
}

/**
 * Encode ids as multi-word hex (low word first) for XMRig --cpu-affinity when ≤256 bits.
 * Prefer cpu-id list in JSON config when span > 64 or word count > 1.
 * @param {number[]} ids
 */
export function idsToMaskHex(ids) {
    if (!ids.length) return null;
    const max = Math.max(...ids);
    const wordCount = Math.floor(max / 64) + 1;
    const words = [];
    for (let wi = 0; wi < wordCount; wi++) {
        let v = 0n;
        for (const id of ids) {
            if (Math.floor(id / 64) !== wi) continue;
            v |= 1n << BigInt(id % 64);
        }
        words.push(`0x${v.toString(16)}`);
    }
    return {
        hex: words.join(','),
        wordCount,
        preferIdList: wordCount > 1 || max >= 64
    };
}
