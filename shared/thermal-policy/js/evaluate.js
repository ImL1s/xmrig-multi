/**
 * Thermal evaluator with hysteresis (#38).
 */

import { DEFAULTS, OS_STATUS_RANK } from './defaults.js';
import { normalizeObservation } from './observe.js';

export { DEFAULTS, OS_STATUS_RANK } from './defaults.js';
export { normalizeObservation } from './observe.js';

/**
 * @typedef {'allowed'|'soft_throttle'|'paused'|'critical'} ThermalPhase
 *
 * @typedef {object} ThermalState
 * @property {ThermalPhase} phase
 * @property {number} sinceMs
 * @property {number|null} [cooldownUntilMs]
 * @property {number|null} [permanentThreads]
 * @property {number|null} [effectiveThreads]
 *
 * @typedef {object} ThermalDecision
 * @property {ThermalPhase} phase
 * @property {'none'|'throttle'|'pause'|'critical_stop'|'hold'|'resume'} action
 * @property {string[]} reasons
 * @property {string|null} resumeWhen
 * @property {number|null} effectiveThreads
 * @property {boolean} permanentProfileUnchanged
 * @property {ThermalState} nextState
 * @property {number|null} nextEvalAtMs
 */

/**
 * @param {object} input
 * @param {object|object[]} input.observation
 * @param {object} [input.config]
 * @param {ThermalState} [input.state]
 * @param {number} [input.nowMs]
 * @param {boolean} [input.userStopped]
 * @returns {ThermalDecision}
 */
export function evaluateThermal(input = {}) {
    const cfg = { ...DEFAULTS, ...(input.config || {}) };
    const nowMs = input.nowMs ?? Date.now();
    const userStopped = Boolean(input.userStopped);
    const prev = input.state || {
        phase: 'allowed',
        sinceMs: nowMs,
        cooldownUntilMs: null,
        permanentThreads: null,
        effectiveThreads: null
    };

    const rawList = Array.isArray(input.observation)
        ? input.observation
        : (input.observation ? [input.observation] : []);
    const observations = rawList.map((o) => normalizeObservation(o, nowMs, cfg));

    if (userStopped) {
        return makeDecision({
            phase: 'paused',
            action: 'hold',
            reasons: ['Manual Stop is active — thermal cool-down will not auto-restart'],
            resumeWhen: 'User must explicitly Start again',
            effectiveThreads: 0,
            prev,
            nowMs,
            cooldownUntilMs: prev.cooldownUntilMs,
            nextEvalAtMs: null
        });
    }

    const severity = worstSeverity(observations, cfg);
    const holdRemaining = holdTimeRemaining(prev, nowMs, cfg);
    const prevRank = phaseRank(prev.phase);
    const sevRank = severityRank(severity.level);

    // Escalation only when new severity is strictly worse (or equal critical/pause entry)
    if (sevRank >= 3 && sevRank >= prevRank) {
        return makeDecision({
            phase: 'critical',
            action: prev.phase === 'critical' ? 'hold' : 'critical_stop',
            reasons: severity.reasons,
            resumeWhen: resumeCopy(severity, cfg),
            effectiveThreads: 0,
            prev,
            nowMs,
            cooldownUntilMs: null,
            nextEvalAtMs: nowMs + cfg.minHoldMs
        });
    }
    if (sevRank >= 2 && sevRank >= prevRank) {
        return makeDecision({
            phase: 'paused',
            action: prev.phase === 'paused' || prev.phase === 'critical' ? 'hold' : 'pause',
            reasons: severity.reasons,
            resumeWhen: resumeCopy(severity, cfg),
            effectiveThreads: 0,
            prev,
            nowMs,
            cooldownUntilMs: null,
            nextEvalAtMs: nowMs + Math.max(holdRemaining, cfg.minHoldMs)
        });
    }
    if (sevRank >= 1 && sevRank >= prevRank && prevRank <= 1) {
        const threads = softThreads(prev.permanentThreads, cfg);
        return makeDecision({
            phase: 'soft_throttle',
            action: prev.phase === 'soft_throttle' ? 'hold' : 'throttle',
            reasons: severity.reasons,
            resumeWhen: resumeCopy(severity, cfg),
            effectiveThreads: threads,
            prev,
            nowMs,
            cooldownUntilMs: null,
            nextEvalAtMs: nowMs + Math.max(holdRemaining, 5_000)
        });
    }

    // De-escalation / recovery — require below resume threshold (hysteresis).
    // If still in pause/critical and only cooled into "soft" band, keep holding.
    if (prev.phase === 'allowed') {
        return makeDecision({
            phase: 'allowed',
            action: 'none',
            reasons: severity.reasons.length ? severity.reasons : ['Thermal conditions nominal'],
            resumeWhen: null,
            effectiveThreads: prev.permanentThreads,
            prev,
            nowMs,
            cooldownUntilMs: null,
            nextEvalAtMs: null
        });
    }

    const cooled = belowResumeThreshold(observations, cfg, nowMs);
    let cooldownUntil = prev.cooldownUntilMs;
    if (cooled && cooldownUntil == null) {
        cooldownUntil = nowMs + cfg.cooldownMs;
    }
    const stillCooling = cooldownUntil != null && nowMs < cooldownUntil;

    if (!cooled || holdRemaining > 0 || stillCooling || !cfg.allowResumeAfterCooldown) {
        const why = [];
        if (!cooled) why.push('Still above resume threshold (hysteresis)');
        if (holdRemaining > 0) why.push(`Min hold ${Math.ceil(holdRemaining / 1000)}s remaining`);
        if (stillCooling) {
            why.push(`Cooldown ${Math.ceil((cooldownUntil - nowMs) / 1000)}s remaining`);
        }
        if (!cfg.allowResumeAfterCooldown) why.push('Auto-resume after cooldown disabled');
        const holdPhase = prev.phase === 'critical' ? 'paused' : prev.phase;
        return makeDecision({
            phase: holdPhase,
            action: 'hold',
            reasons: why.length ? why : ['Waiting for thermal recovery'],
            resumeWhen: resumeCopy(severity, cfg),
            effectiveThreads: holdPhase === 'soft_throttle'
                ? softThreads(prev.permanentThreads, cfg)
                : 0,
            prev,
            nowMs,
            cooldownUntilMs: cooled ? cooldownUntil : prev.cooldownUntilMs,
            nextEvalAtMs: nowMs + Math.max(
                holdRemaining,
                stillCooling ? (cooldownUntil - nowMs) : 5_000
            )
        });
    }

    return makeDecision({
        phase: 'allowed',
        action: 'resume',
        reasons: ['Thermal recovered below resume threshold after cooldown'],
        resumeWhen: null,
        effectiveThreads: prev.permanentThreads,
        prev,
        nowMs,
        cooldownUntilMs: null,
        nextEvalAtMs: null
    });
}

function makeDecision({
    phase,
    action,
    reasons,
    resumeWhen,
    effectiveThreads,
    prev,
    nowMs,
    cooldownUntilMs,
    nextEvalAtMs
}) {
    const phaseChanged = phase !== prev.phase;
    const nextState = {
        phase,
        sinceMs: phaseChanged ? nowMs : prev.sinceMs,
        cooldownUntilMs: cooldownUntilMs === undefined ? prev.cooldownUntilMs : cooldownUntilMs,
        permanentThreads: prev.permanentThreads,
        effectiveThreads: effectiveThreads ?? prev.effectiveThreads
    };

    return {
        phase,
        action,
        reasons: [...reasons],
        resumeWhen,
        effectiveThreads: effectiveThreads ?? null,
        permanentProfileUnchanged: true,
        nextState,
        nextEvalAtMs: nextEvalAtMs ?? null
    };
}

function holdTimeRemaining(prev, nowMs, cfg) {
    if (!prev || prev.phase === 'allowed') return 0;
    const elapsed = nowMs - (prev.sinceMs || nowMs);
    return Math.max(0, cfg.minHoldMs - elapsed);
}

function phaseRank(phase) {
    if (phase === 'critical') return 3;
    if (phase === 'paused') return 2;
    if (phase === 'soft_throttle') return 1;
    return 0;
}

function severityRank(level) {
    if (level === 'critical') return 3;
    if (level === 'pause') return 2;
    if (level === 'soft') return 1;
    return 0;
}

function softThreads(permanent, cfg) {
    if (permanent == null || permanent <= 0) return 1;
    return Math.max(1, Math.floor(permanent * cfg.softThrottleFactor));
}

function resumeCopy(severity, cfg) {
    if (severity.resumeHint) return severity.resumeHint;
    return `Cool below resume threshold and wait cooldown (${Math.round(cfg.cooldownMs / 1000)}s)`;
}

/**
 * @returns {{ level: 'ok'|'soft'|'pause'|'critical', reasons: string[], resumeHint: string|null }}
 */
function worstSeverity(observations, cfg) {
    if (!observations.length) {
        return {
            level: 'soft',
            reasons: ['No thermal observations — conservative soft throttle'],
            resumeHint: 'Provide a valid thermal reading'
        };
    }

    let levelRank = 0; // 0 ok, 1 soft, 2 pause, 3 critical
    const reasons = [];
    let resumeHint = null;

    for (const obs of observations) {
        const s = scoreObservation(obs, cfg);
        if (s.rank > levelRank) {
            levelRank = s.rank;
            resumeHint = s.resumeHint;
        }
        if (s.reason) reasons.push(s.reason);
    }

    const level = levelRank >= 3 ? 'critical' : levelRank === 2 ? 'pause' : levelRank === 1 ? 'soft' : 'ok';
    return { level, reasons, resumeHint };
}

function scoreObservation(obs, cfg) {
    if (obs.quality === 'unsupported' || obs.quality === 'nan' || obs.quality === 'sentinel' || obs.quality === 'unknown') {
        return {
            rank: 1,
            reason: obs.note || `Thermal ${obs.source} quality=${obs.quality} — not treating as healthy`,
            resumeHint: 'Valid sensor reading required'
        };
    }
    if (obs.quality === 'stale') {
        return {
            rank: 1,
            reason: obs.note || `Stale ${obs.source} reading`,
            resumeHint: 'Fresh thermal sample required'
        };
    }

    if (obs.source === 'os_status') {
        const rank = OS_STATUS_RANK[obs.osStatus] ?? 1;
        if (rank >= OS_STATUS_RANK.critical) {
            return {
                rank: 3,
                reason: `OS thermal status ${obs.osStatus} (critical protection)`,
                resumeHint: 'OS thermal status must return to none/light'
            };
        }
        if (rank >= OS_STATUS_RANK.severe) {
            return {
                rank: 2,
                reason: `OS thermal status ${obs.osStatus}`,
                resumeHint: 'Wait for OS thermal status to ease'
            };
        }
        if (rank >= OS_STATUS_RANK.moderate) {
            return {
                rank: 1,
                reason: `OS thermal status ${obs.osStatus} — soft throttle`,
                resumeHint: 'Wait for OS thermal status none/light'
            };
        }
        return { rank: 0, reason: null, resumeHint: null };
    }

    if (obs.source === 'headroom') {
        // headroom: lower is worse; <0 critical territory per ADPF guidance
        if (obs.headroom < 0) {
            return {
                rank: 3,
                reason: `Thermal headroom ${obs.headroom} < 0`,
                resumeHint: 'Headroom must recover above 0'
            };
        }
        if (obs.headroom < 25) {
            return {
                rank: 2,
                reason: `Low thermal headroom (${obs.headroom})`,
                resumeHint: 'Headroom above 25'
            };
        }
        if (obs.headroom < 50) {
            return {
                rank: 1,
                reason: `Reduced thermal headroom (${obs.headroom})`,
                resumeHint: 'Headroom above 50'
            };
        }
        return { rank: 0, reason: null, resumeHint: null };
    }

    const limits = limitsFor(obs.source, cfg);
    const c = obs.celsius;
    if (c == null) {
        return {
            rank: 1,
            reason: `${obs.source} temperature missing`,
            resumeHint: 'Valid temperature required'
        };
    }
    if (c >= limits.criticalC) {
        return {
            rank: 3,
            reason: `${obs.source} ${c}°C ≥ critical ${limits.criticalC}°C`,
            resumeHint: `Cool below ${limits.resumeC}°C`
        };
    }
    if (c >= limits.pauseC) {
        return {
            rank: 2,
            reason: `${obs.source} ${c}°C ≥ pause ${limits.pauseC}°C`,
            resumeHint: `Cool below ${limits.resumeC}°C`
        };
    }
    if (c >= limits.softC) {
        return {
            rank: 1,
            reason: `${obs.source} ${c}°C ≥ soft ${limits.softC}°C`,
            resumeHint: `Cool below ${limits.resumeC}°C`
        };
    }
    // For recovery checks, still report if above resume while previously hot — handled by phase machine
    return { rank: 0, reason: null, resumeHint: `Stay below ${limits.resumeC}°C` };
}

function limitsFor(source, cfg) {
    if (source === 'cpu' || source === 'package') {
        return {
            softC: cfg.cpuSoftC,
            pauseC: cfg.cpuPauseC,
            criticalC: cfg.cpuCriticalC,
            resumeC: cfg.cpuResumeC
        };
    }
    return {
        softC: cfg.batterySoftC,
        pauseC: cfg.batteryPauseC,
        criticalC: cfg.batteryCriticalC,
        resumeC: cfg.batteryResumeC
    };
}

/**
 * True when temperature is below the resume threshold for all temp observations.
 * Used by callers that want an explicit gate before resume.
 */
export function belowResumeThreshold(observations, cfg = DEFAULTS, nowMs = Date.now()) {
    const list = (Array.isArray(observations) ? observations : [observations])
        .map((o) => normalizeObservation(o, nowMs, cfg));
    if (!list.length) return false;
    for (const obs of list) {
        if (obs.quality !== 'ok') return false;
        if (obs.source === 'os_status') {
            const rank = OS_STATUS_RANK[obs.osStatus] ?? 99;
            if (rank > OS_STATUS_RANK.light) return false;
            continue;
        }
        if (obs.source === 'headroom') {
            if (obs.headroom == null || obs.headroom < 50) return false;
            continue;
        }
        const limits = limitsFor(obs.source, cfg);
        if (obs.celsius == null || obs.celsius > limits.resumeC) return false;
    }
    return true;
}
