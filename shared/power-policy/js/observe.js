/**
 * Normalize power / battery observations (#39).
 */

/**
 * @typedef {'ac'|'usb'|'wireless'|'unknown'|null} PowerSource
 * @typedef {'charging'|'full'|'not_charging'|'discharging'|'unknown'} ChargingStatus
 * @typedef {'ok'|'unknown'|'unavailable'|'failed'} PowerQuality
 *
 * @typedef {object} PowerObservation
 * @property {boolean} platformHasBattery
 * @property {boolean} batteryApiAvailable
 * @property {boolean|null} externalPowerPresent
 * @property {PowerSource} powerSource
 * @property {ChargingStatus} chargingStatus
 * @property {number|null} socPercent
 * @property {number|null} batteryTempC
 * @property {number|null} netBatteryFlowMa
 * @property {PowerQuality} quality
 * @property {string|null} [note]
 * @property {number} timestampMs
 */

/**
 * @param {object} raw
 * @param {number} [nowMs]
 * @returns {PowerObservation}
 */
export function normalizePowerObservation(raw = {}, nowMs = Date.now()) {
    const platformHasBattery = raw.platformHasBattery !== false;
    const batteryApiAvailable = raw.batteryApiAvailable !== false;

    if (!platformHasBattery) {
        return {
            platformHasBattery: false,
            batteryApiAvailable: false,
            externalPowerPresent: null,
            powerSource: null,
            chargingStatus: 'unknown',
            socPercent: null,
            batteryTempC: null,
            netBatteryFlowMa: null,
            quality: 'unavailable',
            note: 'No battery (desktop/AC appliance) — battery limits not applicable',
            timestampMs: nowMs
        };
    }

    if (!batteryApiAvailable) {
        return {
            platformHasBattery: true,
            batteryApiAvailable: false,
            externalPowerPresent: null,
            powerSource: null,
            chargingStatus: 'unknown',
            socPercent: null,
            batteryTempC: null,
            netBatteryFlowMa: null,
            quality: 'unavailable',
            note: 'Battery API unavailable — do not pretend compliance',
            timestampMs: nowMs
        };
    }

    const externalPowerPresent = toBoolOrNull(raw.externalPowerPresent ?? raw.plugged);
    const powerSource = normalizeSource(raw.powerSource ?? raw.pluggedSource);
    const chargingStatus = normalizeStatus(raw.chargingStatus ?? raw.status);
    let socPercent = toSoc(raw.socPercent ?? raw.level ?? raw.batteryLevel);
    const batteryTempC = toFiniteOrNull(raw.batteryTempC ?? raw.temperature);
    const netBatteryFlowMa = toFiniteOrNull(raw.netBatteryFlowMa ?? raw.currentNowMa);
    const timestampMs = Number.isFinite(raw.timestampMs) ? raw.timestampMs : nowMs;

    let quality = raw.quality && ['ok', 'unknown', 'unavailable', 'failed'].includes(raw.quality)
        ? raw.quality
        : 'ok';
    let note = raw.note || null;

    if (socPercent === null && externalPowerPresent === null && chargingStatus === 'unknown' && quality === 'ok') {
        quality = 'unknown';
        note = note || 'Insufficient battery signals';
    }

    // Fake 0 / sentinel SOC
    if (socPercent === 0 && (raw.suspectZero === true || raw.quality === 'sentinel')) {
        socPercent = null;
        quality = 'failed';
        note = 'Sentinel SOC 0 ignored';
    }

    if (raw.readFailed === true) {
        quality = 'failed';
        note = raw.note || 'Battery read failed';
    }

    // Idempotent: already-cleared sentinel SOC stays failed
    if (socPercent === null && raw.quality === 'failed' && /sentinel/i.test(String(raw.note || ''))) {
        quality = 'failed';
        note = raw.note;
    }

    return {
        platformHasBattery: true,
        batteryApiAvailable: true,
        externalPowerPresent,
        powerSource,
        chargingStatus,
        socPercent,
        batteryTempC,
        netBatteryFlowMa,
        quality,
        note,
        timestampMs
    };
}

/**
 * Plugged but OEM charge-limit held at ~80% with NOT_CHARGING is still external power.
 * FULL without plugged confirmation is NOT assumed to be on charger.
 */
export function isEffectivelyPlugged(obs) {
    if (obs.externalPowerPresent === true) return true;
    if (obs.externalPowerPresent === false) return false;
    // Unknown plugged: do not infer from FULL alone
    if (obs.chargingStatus === 'charging') return true;
    return false;
}

export function isActivelyCharging(obs) {
    return obs.chargingStatus === 'charging'
        || (obs.chargingStatus === 'full' && isEffectivelyPlugged(obs));
}

function normalizeSource(s) {
    if (s == null || s === '') return null;
    const v = String(s).toLowerCase();
    if (['ac', 'usb', 'wireless', 'unknown'].includes(v)) return v;
    if (v.includes('ac') || v.includes('dock')) return 'ac';
    if (v.includes('usb')) return 'usb';
    if (v.includes('wireless') || v.includes('wireless')) return 'wireless';
    return 'unknown';
}

function normalizeStatus(s) {
    if (s == null) return 'unknown';
    const v = String(s).toLowerCase().replace(/battery_status_/g, '');
    if (['charging', 'full', 'not_charging', 'discharging', 'unknown'].includes(v)) return v;
    if (v.includes('charg')) return 'charging';
    if (v.includes('full')) return 'full';
    if (v.includes('discharg')) return 'discharging';
    if (v.includes('not')) return 'not_charging';
    return 'unknown';
}

function toBoolOrNull(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'boolean') return v;
    if (v === 1 || v === '1' || v === 'true') return true;
    if (v === 0 || v === '0' || v === 'false') return false;
    return null;
}

function toSoc(v) {
    const n = toFiniteOrNull(v);
    if (n === null) return null;
    if (n < 0 || n > 100) return null;
    return Math.round(n);
}

function toFiniteOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
}
