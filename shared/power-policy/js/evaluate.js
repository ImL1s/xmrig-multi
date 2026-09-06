/**
 * Power / convenience policy evaluator (#39).
 */

import { DEFAULTS } from './defaults.js';
import {
    normalizePowerObservation,
    isEffectivelyPlugged,
    isActivelyCharging
} from './observe.js';
import { evaluateSchedule } from './schedule.js';

export { DEFAULTS } from './defaults.js';
export {
    normalizePowerObservation,
    isEffectivelyPlugged,
    isActivelyCharging
} from './observe.js';
export { evaluateSchedule, inWindow } from './schedule.js';

/**
 * @typedef {'Allowed'|'Waiting'|'Paused'|'UserStopped'|'Unavailable'} PowerVerdictKind
 *
 * @typedef {object} PowerIntent
 * @property {boolean} automationArmed
 * @property {number} userStopRevision
 * @property {number} sessionArmedRevision  must be >= userStopRevision to run
 * @property {boolean} [pauseUntilNextPlug]
 * @property {boolean} [wasPluggedWhenPaused]
 *
 * @typedef {object} PowerVerdict
 * @property {PowerVerdictKind} kind
 * @property {string[]} reasons
 * @property {string|null} resumeWhen
 * @property {number|null} nextEvalAtMs
 * @property {boolean} preservesSessionData
 * @property {'none'|'pause'|'wait'|'unavailable'} suggestedAction
 * @property {PowerIntent} nextIntent
 */

/**
 * @param {object} input
 * @returns {PowerVerdict}
 */
export function evaluatePower(input = {}) {
    const cfg = { ...DEFAULTS, ...(input.config || {}) };
    const nowMs = input.nowMs ?? Date.now();
    const intent = {
        automationArmed: false,
        userStopRevision: 0,
        sessionArmedRevision: 0,
        pauseUntilNextPlug: false,
        wasPluggedWhenPaused: false,
        ...(input.intent || {})
    };
    const obs = normalizePowerObservation(input.observation || {}, nowMs);
    const network = input.network || { metered: false, available: true };
    const idle = input.idle || { idleMs: 0 };
    const session = input.session || { startedAtMs: null, elapsedMs: 0 };
    const minuteOfDay = input.minuteOfDay ?? null;

    // Manual Stop always wins
    if (intent.userStopRevision > intent.sessionArmedRevision) {
        return verdict({
            kind: 'UserStopped',
            reasons: [
                'Manual Stop is latched — AC plug, schedule, or cooldown cannot revive mining'
            ],
            resumeWhen: 'Explicit Start or re-arm automation (bumps sessionArmedRevision)',
            nextEvalAtMs: null,
            suggestedAction: 'pause',
            intent
        });
    }

    // No battery / no API
    if (obs.quality === 'unavailable') {
        // Desktop without battery: battery rules N/A — allow unless other constraints fail
        if (!obs.platformHasBattery) {
            return finishNonBattery({ cfg, nowMs, intent, network, idle, session, minuteOfDay });
        }
        return verdict({
            kind: 'Unavailable',
            reasons: [obs.note || 'Battery API unavailable'],
            resumeWhen: 'Platform with trusted battery/power APIs',
            nextEvalAtMs: null,
            suggestedAction: 'unavailable',
            intent
        });
    }

    if (obs.quality === 'failed' || obs.quality === 'unknown') {
        return verdict({
            kind: 'Waiting',
            reasons: [obs.note || 'Battery signals unknown — waiting conservatively'],
            resumeWhen: 'Valid battery observation',
            nextEvalAtMs: nowMs + 30_000,
            suggestedAction: 'wait',
            intent
        });
    }

    const reasons = [];
    let nextEvalAtMs = null;
    const plugged = isEffectivelyPlugged(obs);
    let nextIntent = { ...intent };

    // pause-until-next-plug: wait for unplug→plug edge
    if (intent.pauseUntilNextPlug) {
        if (intent.wasPluggedWhenPaused && !plugged) {
            nextIntent = { ...nextIntent, wasPluggedWhenPaused: false };
        }
        if (!intent.wasPluggedWhenPaused && plugged) {
            nextIntent = {
                ...nextIntent,
                pauseUntilNextPlug: false,
                wasPluggedWhenPaused: false
            };
        } else {
            return verdict({
                kind: 'Waiting',
                reasons: ['Paused until next plug cycle'],
                resumeWhen: 'Unplug then plug external power (explicit pause-until-next-plug)',
                nextEvalAtMs: nowMs + 15_000,
                suggestedAction: 'wait',
                intent: nextIntent
            });
        }
    }

    // Schedule
    const sched = evaluateSchedule(nowMs, cfg.allowWindows || [], minuteOfDay);
    if (!sched.allowed) {
        reasons.push(sched.reason);
        return verdict({
            kind: 'Waiting',
            reasons,
            resumeWhen: 'Next allowed schedule window',
            nextEvalAtMs: sched.nextEvalAtMs,
            suggestedAction: 'wait',
            intent: nextIntent
        });
    }
    if (sched.nextEvalAtMs != null) nextEvalAtMs = sched.nextEvalAtMs;

    // Idle gate (automation only)
    if (cfg.idleAfterMs != null && intent.automationArmed) {
        if ((idle.idleMs || 0) < cfg.idleAfterMs) {
            return verdict({
                kind: 'Waiting',
                reasons: [`Idle ${idle.idleMs || 0}ms < required ${cfg.idleAfterMs}ms`],
                resumeWhen: `Device idle for ${cfg.idleAfterMs}ms`,
                nextEvalAtMs: nowMs + Math.max(1_000, cfg.idleAfterMs - (idle.idleMs || 0)),
                suggestedAction: 'wait',
                intent: nextIntent
            });
        }
    }

    // Network metered preference
    if (cfg.preferUnmetered && network.metered === true) {
        return verdict({
            kind: 'Waiting',
            reasons: ['Metered network — prefer unmetered enabled'],
            resumeWhen: 'Unmetered / Wi‑Fi connection',
            nextEvalAtMs: nowMs + 30_000,
            suggestedAction: 'wait',
            intent: nextIntent
        });
    }
    if (network.available === false) {
        return verdict({
            kind: 'Paused',
            reasons: ['Network unavailable'],
            resumeWhen: 'Network restored',
            nextEvalAtMs: nowMs + 15_000,
            suggestedAction: 'pause',
            intent: nextIntent
        });
    }

    // Max session
    const elapsed = session.elapsedMs != null
        ? session.elapsedMs
        : (session.startedAtMs != null ? nowMs - session.startedAtMs : 0);
    if (cfg.maxSessionMs != null && elapsed >= cfg.maxSessionMs) {
        return verdict({
            kind: 'Paused',
            reasons: [`Max session ${cfg.maxSessionMs}ms reached`],
            resumeWhen: 'New user-started session',
            nextEvalAtMs: null,
            suggestedAction: 'pause',
            intent: nextIntent
        });
    }

    // External power / charging rules
    if (cfg.requireExternalPower || cfg.pauseOnUnplug) {
        if (!plugged) {
            reasons.push(
                obs.chargingStatus === 'full'
                    ? 'Battery FULL but not plugged — not treated as on charger'
                    : 'External power not present'
            );
            return verdict({
                kind: 'Paused',
                reasons,
                resumeWhen: 'Plug AC/USB/wireless power',
                nextEvalAtMs: nowMs + 15_000,
                suggestedAction: 'pause',
                intent: nextIntent
            });
        }
    }

    // Charge-to-target before mining (plugged but SOC low)
    if (
        cfg.chargeToPercentBeforeMine != null &&
        plugged &&
        obs.socPercent != null &&
        obs.socPercent < cfg.chargeToPercentBeforeMine
    ) {
        return verdict({
            kind: 'Waiting',
            reasons: [
                `Charging first: SOC ${obs.socPercent}% < target ${cfg.chargeToPercentBeforeMine}%`
            ],
            resumeWhen: `Reach ${cfg.chargeToPercentBeforeMine}% while plugged (then mine)`,
            nextEvalAtMs: nowMs + 30_000,
            suggestedAction: 'wait',
            intent: nextIntent
        });
    }

    // Plugged @ OEM limit NOT_CHARGING is OK if SOC already at/above target
    // Net discharge while plugged
    if (
        cfg.pauseOnNetDischargeWhilePlugged &&
        plugged &&
        obs.netBatteryFlowMa != null &&
        obs.netBatteryFlowMa <= cfg.netDischargeThresholdMa
    ) {
        return verdict({
            kind: 'Paused',
            reasons: [
                `Sustained net discharge while plugged (${obs.netBatteryFlowMa} mA ≤ ${cfg.netDischargeThresholdMa})`
            ],
            resumeWhen: 'Charger supplying net positive current',
            nextEvalAtMs: nowMs + (cfg.netDischargeWindowMs || 60_000),
            suggestedAction: 'pause',
            intent: nextIntent
        });
    }

    // Min battery with hysteresis (primarily when unplugged — if we get here unplugged only when requireExternalPower false)
    if (!plugged && obs.socPercent != null) {
        const low = obs.socPercent < cfg.minBatteryPercent;
        // For hysteresis, callers should pass intent.batteryPaused
        if (low || (intent.batteryPaused && obs.socPercent < cfg.resumeBatteryPercent)) {
            nextIntent = { ...nextIntent, batteryPaused: true };
            return verdict({
                kind: 'Paused',
                reasons: [
                    low
                        ? `Battery ${obs.socPercent}% < min ${cfg.minBatteryPercent}%`
                        : `Battery ${obs.socPercent}% < resume ${cfg.resumeBatteryPercent}% (hysteresis)`
                ],
                resumeWhen: `Charge to ≥ ${cfg.resumeBatteryPercent}%`,
                nextEvalAtMs: nowMs + 30_000,
                suggestedAction: 'pause',
                intent: nextIntent
            });
        }
        nextIntent = { ...nextIntent, batteryPaused: false };
    }

    return verdict({
        kind: 'Allowed',
        reasons: reasons.length ? reasons : ['Power policy satisfied'],
        resumeWhen: null,
        nextEvalAtMs,
        suggestedAction: 'none',
        intent: { ...nextIntent, batteryPaused: false }
    });
}

function finishNonBattery({ cfg, nowMs, intent, network, idle, session, minuteOfDay }) {
    const sched = evaluateSchedule(nowMs, cfg.allowWindows || [], minuteOfDay);
    if (!sched.allowed) {
        return verdict({
            kind: 'Waiting',
            reasons: [sched.reason],
            resumeWhen: 'Next allowed schedule window',
            nextEvalAtMs: sched.nextEvalAtMs,
            suggestedAction: 'wait',
            intent
        });
    }
    if (cfg.preferUnmetered && network.metered === true) {
        return verdict({
            kind: 'Waiting',
            reasons: ['Metered network — prefer unmetered enabled'],
            resumeWhen: 'Unmetered connection',
            nextEvalAtMs: nowMs + 30_000,
            suggestedAction: 'wait',
            intent
        });
    }
    if (network.available === false) {
        return verdict({
            kind: 'Paused',
            reasons: ['Network unavailable'],
            resumeWhen: 'Network restored',
            nextEvalAtMs: nowMs + 15_000,
            suggestedAction: 'pause',
            intent
        });
    }
    const elapsed = session.elapsedMs != null
        ? session.elapsedMs
        : (session.startedAtMs != null ? nowMs - session.startedAtMs : 0);
    if (cfg.maxSessionMs != null && elapsed >= cfg.maxSessionMs) {
        return verdict({
            kind: 'Paused',
            reasons: [`Max session ${cfg.maxSessionMs}ms reached`],
            resumeWhen: 'New user-started session',
            nextEvalAtMs: null,
            suggestedAction: 'pause',
            intent
        });
    }
    if (cfg.idleAfterMs != null && intent.automationArmed && (idle.idleMs || 0) < cfg.idleAfterMs) {
        return verdict({
            kind: 'Waiting',
            reasons: [`Idle ${idle.idleMs || 0}ms < required ${cfg.idleAfterMs}ms`],
            resumeWhen: `Device idle for ${cfg.idleAfterMs}ms`,
            nextEvalAtMs: nowMs + 1_000,
            suggestedAction: 'wait',
            intent
        });
    }
    return verdict({
        kind: 'Allowed',
        reasons: ['No battery — power limits not applicable; other policies OK'],
        resumeWhen: null,
        nextEvalAtMs: sched.nextEvalAtMs,
        suggestedAction: 'none',
        intent
    });
}

function verdict({ kind, reasons, resumeWhen, nextEvalAtMs, suggestedAction, intent }) {
    return {
        kind,
        reasons: [...reasons],
        resumeWhen,
        nextEvalAtMs,
        preservesSessionData: true,
        suggestedAction,
        nextIntent: { ...intent }
    };
}

/** Bump stop revision — automation must not revive. */
export function latchUserStop(intent = {}) {
    const rev = (intent.userStopRevision || 0) + 1;
    return {
        ...intent,
        userStopRevision: rev,
        automationArmed: false,
        pauseUntilNextPlug: false
    };
}

/** Explicit user Start / re-arm. */
export function armSession(intent = {}, { automationArmed = false } = {}) {
    const stop = intent.userStopRevision || 0;
    return {
        ...intent,
        sessionArmedRevision: stop,
        automationArmed,
        pauseUntilNextPlug: false,
        batteryPaused: false
    };
}

/** Explicit pause-until-next-plug (not Stop). */
export function pauseUntilNextPlug(intent = {}, currentlyPlugged = true) {
    return {
        ...intent,
        pauseUntilNextPlug: true,
        wasPluggedWhenPaused: currentlyPlugged
    };
}
