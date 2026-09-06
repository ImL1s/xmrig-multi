/**
 * Shared i18n catalog + unit formatting (#59).
 */

export const STATUS = Object.freeze({
    connecting: {
        code: 'connecting',
        en: 'Connecting',
        'zh-Hant': '正在連線'
    },
    initializing: {
        code: 'initializing',
        en: 'Initializing',
        'zh-Hant': '正在初始化'
    },
    computing: {
        code: 'computing',
        en: 'Computing',
        'zh-Hant': '計算中'
    },
    waiting_share: {
        code: 'waiting_share',
        en: 'Waiting for share',
        'zh-Hant': '等待 share'
    },
    stopped: {
        code: 'stopped',
        en: 'Stopped',
        'zh-Hant': '已停止'
    },
    paused_thermal: {
        code: 'paused_thermal',
        en: 'Paused — overheating',
        'zh-Hant': '因過熱暫停'
    },
    paused_power: {
        code: 'paused_power',
        en: 'Paused — power policy',
        'zh-Hant': '因電源政策暫停'
    },
    system_limited: {
        code: 'system_limited',
        en: 'Limited by system',
        'zh-Hant': '受系統限制'
    }
});

export const TERMS = Object.freeze({
    hashrate: { en: 'Hashrate', 'zh-Hant': '算力' },
    threads: { en: 'Threads', 'zh-Hant': '執行緒' },
    pool: { en: 'Pool', 'zh-Hant': '礦池' },
    proxy: { en: 'Proxy', 'zh-Hant': '代理' },
    scratchpad: { en: 'Scratchpad', 'zh-Hant': '暫存區' },
    accepted: { en: 'Accepted', 'zh-Hant': '已接受' },
    rejected: { en: 'Rejected', 'zh-Hant': '已拒絕' }
});

/**
 * @param {string} code
 * @param {'en'|'zh-Hant'} locale
 */
export function t(code, locale = 'en', table = STATUS) {
    const row = table[code];
    if (!row) return { code, text: code, missing: true };
    const text = row[locale] || row.en || code;
    return { code, text, missing: false };
}

/**
 * Format hashrate. null/NaN/undefined → unavailable, never "0".
 * Protocol serialization must use {@link protocolNumber}.
 */
export function formatHashrate(value, locale = 'en') {
    if (value == null || Number.isNaN(Number(value))) {
        return { text: locale === 'zh-Hant' ? '無法取得' : 'Unavailable', unit: null, unknown: true };
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
        return { text: locale === 'zh-Hant' ? '無法取得' : 'Unavailable', unit: null, unknown: true };
    }
    if (n >= 1e6) return { text: trim(n / 1e6), unit: 'MH/s', unknown: false };
    if (n >= 1e3) return { text: trim(n / 1e3), unit: 'kH/s', unknown: false };
    return { text: trim(n), unit: 'H/s', unknown: false };
}

export function formatBytesMiB(value, locale = 'en') {
    if (value == null || !Number.isFinite(Number(value))) {
        return { text: locale === 'zh-Hant' ? '未知' : 'Unknown', unit: null, unknown: true };
    }
    const mib = Number(value);
    if (mib >= 1024) return { text: trim(mib / 1024), unit: 'GiB', unknown: false };
    return { text: trim(mib), unit: 'MiB', unknown: false };
}

/** Never locale-format protocol numbers (no thousands separators). */
export function protocolNumber(value) {
    if (value == null || !Number.isFinite(Number(value))) return null;
    return String(Number(value));
}

/**
 * Locale switch must not mutate mining identifiers.
 */
export function localizeUiOnly(session, locale) {
    return {
        ...session,
        locale,
        // identifiers preserved
        algorithm: session.algorithm,
        endpoint: session.endpoint,
        draft: session.draft
    };
}

function trim(n) {
    return String(Math.round(n * 100) / 100);
}
