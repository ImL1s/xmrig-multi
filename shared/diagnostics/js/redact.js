/**
 * Secret redaction for diagnostics (#55).
 */

const WALLET_RE = /\b[48][0-9A-Za-z]{94,105}\b/g;
const HEX_TOKEN_RE = /\b[a-f0-9]{16,64}\b/gi;
const URI_USERINFO_RE = /([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/gi;
const PASSWORD_KV_RE = /\b(password|passwd|pass|api[_-]?token|access[_-]?token|secret|seed|spend[_-]?key|private[_-]?key)\s*[=:]\s*([^\s,;]+)/gi;
const SEED_PHRASE_RE = /\b([a-z]+(?:\s+[a-z]+){11,24})\b/gi;

/**
 * @param {string} text
 * @returns {string}
 */
export function redactText(text) {
    let out = String(text ?? '');
    out = out.replace(URI_USERINFO_RE, '$1***@');
    out = out.replace(PASSWORD_KV_RE, '$1=***');
    out = out.replace(WALLET_RE, (m) => `${m.slice(0, 4)}…${m.slice(-4)}`);
    out = out.replace(SEED_PHRASE_RE, (m) => {
        const words = m.trim().split(/\s+/);
        if (words.length >= 12 && words.length <= 25 && words.every((w) => /^[a-z]+$/.test(w))) {
            return '[seed-redacted]';
        }
        return m;
    });
    // Long hex tokens (API tokens) — keep short hashes
    out = out.replace(HEX_TOKEN_RE, (m) => (m.length >= 24 ? '[token-redacted]' : m));
    return out;
}

/**
 * Deep redact strings in JSON-compatible values.
 * @param {any} value
 */
export function redactValue(value) {
    if (typeof value === 'string') return redactText(value);
    if (Array.isArray(value)) return value.map(redactValue);
    if (value && typeof value === 'object') {
        /** @type {Record<string, any>} */
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            const key = k.toLowerCase();
            if (
                key.includes('password')
                || key.includes('token')
                || key.includes('seed')
                || key.includes('spend')
                || key.includes('secret')
                || key === 'wallet'
                || key === 'walletaddress'
                || key === 'wallet_address'
            ) {
                out[k] = typeof v === 'string' && (key === 'wallet' || key.includes('wallet'))
                    ? redactText(v)
                    : '[redacted]';
            } else {
                out[k] = redactValue(v);
            }
        }
        return out;
    }
    return value;
}
