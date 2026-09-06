/**
 * Normalize thermal sensor readings (#38).
 * Unknown / stale / NaN / unsupported headroom must never look healthy.
 */

import { DEFAULTS } from './defaults.js';

/**
 * @typedef {'battery'|'cpu'|'package'|'os_status'|'headroom'} ThermalSource
 * @typedef {'ok'|'stale'|'unknown'|'unsupported'|'nan'|'sentinel'} ObservationQuality
 *
 * @typedef {object} ThermalObservation
 * @property {ThermalSource} source
 * @property {number|null} [celsius]
 * @property {string|null} [osStatus] none|light|moderate|severe|critical|emergency|shutdown
 * @property {number|null} [headroom]
 * @property {number} timestampMs
 * @property {ObservationQuality} quality
 * @property {string|null} [note]
 */

/**
 * @param {object} raw
 * @param {number} [nowMs]
 * @param {object} [cfg]
 * @returns {ThermalObservation}
 */
export function normalizeObservation(raw = {}, nowMs = Date.now(), cfg = DEFAULTS) {
    const source = normalizeSource(raw.source);
    const timestampMs = Number.isFinite(raw.timestampMs) ? raw.timestampMs : nowMs;
    const age = nowMs - timestampMs;

    if (source === 'os_status') {
        const osStatus = normalizeOsStatus(raw.osStatus ?? raw.status);
        if (!osStatus) {
            return {
                source,
                celsius: null,
                osStatus: null,
                headroom: null,
                timestampMs,
                quality: 'unknown',
                note: 'OS thermal status unavailable'
            };
        }
        const quality = age > cfg.staleAfterMs ? 'stale' : 'ok';
        return { source, celsius: null, osStatus, headroom: null, timestampMs, quality, note: null };
    }

    if (source === 'headroom') {
        const h = toFiniteOrNull(raw.headroom ?? raw.value);
        if (h === null || Number.isNaN(h)) {
            return {
                source,
                celsius: null,
                osStatus: null,
                headroom: null,
                timestampMs,
                quality: raw.headroom === undefined ? 'unsupported' : 'nan',
                note: 'Thermal headroom unsupported or NaN — not treated as healthy'
            };
        }
        const quality = age > cfg.staleAfterMs ? 'stale' : 'ok';
        return { source, celsius: null, osStatus: null, headroom: h, timestampMs, quality, note: null };
    }

    // temperature sources (idempotent if already normalized)
    const celsius = toFiniteOrNull(raw.celsius ?? raw.tempC ?? raw.temperature);
    if (celsius === null) {
        const preserved = preserveBadQuality(raw.quality);
        return {
            source,
            celsius: null,
            osStatus: null,
            headroom: null,
            timestampMs,
            quality: preserved || 'unknown',
            note: raw.note || (preserved === 'sentinel'
                ? '0°C sentinel — not treated as healthy'
                : 'Temperature reading missing')
        };
    }
    if (Number.isNaN(celsius)) {
        return {
            source,
            celsius: null,
            osStatus: null,
            headroom: null,
            timestampMs,
            quality: 'nan',
            note: 'Temperature NaN'
        };
    }
    // Sentinel / fake zeros are not "cold and healthy"
    if (celsius === 0 && (raw.quality === 'sentinel' || raw.suspectZero === true || raw.missing === true)) {
        return {
            source,
            celsius: null,
            osStatus: null,
            headroom: null,
            timestampMs,
            quality: 'sentinel',
            note: '0°C sentinel — not treated as healthy'
        };
    }
    if (age > cfg.staleAfterMs) {
        return {
            source,
            celsius,
            osStatus: null,
            headroom: null,
            timestampMs,
            quality: 'stale',
            note: `Stale by ${Math.round(age / 1000)}s`
        };
    }
    return {
        source,
        celsius,
        osStatus: null,
        headroom: null,
        timestampMs,
        quality: 'ok',
        note: null
    };
}

function normalizeSource(s) {
    const v = String(s || 'battery').toLowerCase();
    if (['battery', 'cpu', 'package', 'os_status', 'headroom'].includes(v)) return v;
    return 'battery';
}

function normalizeOsStatus(s) {
    if (s == null) return null;
    const v = String(s).toLowerCase().replace(/thermalstate\.?/g, '');
    const map = {
        none: 'none',
        nominal: 'none',
        light: 'light',
        fair: 'light',
        moderate: 'moderate',
        serious: 'severe',
        severe: 'severe',
        critical: 'critical',
        emergency: 'emergency',
        shutdown: 'shutdown'
    };
    return map[v] || null;
}

function toFiniteOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return Number.isNaN(n) ? NaN : null;
    return n;
}

function preserveBadQuality(q) {
    if (q && ['stale', 'unknown', 'unsupported', 'nan', 'sentinel'].includes(q)) return q;
    return null;
}
