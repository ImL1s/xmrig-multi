/**
 * De-identified hardware capability export (#33).
 * Strips hostname, MAC, serials, and personal machine names by default.
 */

const SENSITIVE_KEY = /^(host|hostname|serial|mac|uuid|machine|computer|user|username|home|ssid)/i;
const SENSITIVE_VALUE = /\b([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/**
 * @param {object} snapshot
 * @param {{ includeHostname?: boolean }} [opts]
 */
export function sanitizeHardwareReport(snapshot, opts = {}) {
    const clone = structuredClone ? structuredClone(snapshot) : JSON.parse(JSON.stringify(snapshot));
    walk(clone, opts);
    // Ensure report metadata never embeds identity fields.
    delete clone.hostname;
    delete clone.hostName;
    delete clone.machineId;
    delete clone.serial;
    delete clone.macAddresses;
    return {
        schemaVersion: 1,
        reportKind: 'hardware-capability',
        redacted: true,
        generatedAt: new Date().toISOString(),
        snapshot: clone
    };
}

function walk(node, opts) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
        for (const item of node) walk(item, opts);
        return;
    }
    for (const key of Object.keys(node)) {
        if (!opts.includeHostname && SENSITIVE_KEY.test(key)) {
            delete node[key];
            continue;
        }
        const v = node[key];
        if (typeof v === 'string' && SENSITIVE_VALUE.test(v)) {
            node[key] = '[redacted]';
            continue;
        }
        // CPU name is OK (model), but strip trailing host-like suffixes users sometimes paste.
        if (key === 'value' && typeof v === 'string' && /@|\\\\/.test(v)) {
            node[key] = v.split('@')[0].trim();
        }
        walk(v, opts);
    }
}
