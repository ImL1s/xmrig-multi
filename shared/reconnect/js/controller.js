/**
 * Session-owner reconnect controller (#43).
 * Platforms ask this module what to do; they do not invent parallel retry loops.
 */

import { classifyDisconnect } from './classify.js';
import { canAttempt, nextBackoff } from './backoff.js';
import { selectFailoverTarget, shouldReturnToPrimary } from './failover.js';

/** @typedef {'idle'|'mining'|'reconnecting'|'failover'|'paused'|'stopped'|'failed'} ReconnectPhase */

/**
 * @param {object} [seed]
 */
export function createReconnectState(seed = {}) {
    return {
        phase: seed.phase || 'idle',
        autoReconnect: seed.autoReconnect !== false,
        maxAttempts: seed.maxAttempts ?? seed.retries ?? 5,
        baseMs: seed.baseMs ?? ((seed.retryPauseSec ?? 5) * 1000),
        maxMs: seed.maxMs ?? 60_000,
        attempt: seed.attempt || 0,
        reason: seed.reason || null,
        nextRetryAt: seed.nextRetryAt || null,
        activeEndpointId: seed.activeEndpointId || null,
        primaryEndpointId: seed.primaryEndpointId || null,
        lastClassification: seed.lastClassification || null,
        profileRevision: seed.profileRevision || 0,
        sessionStats: seed.sessionStats || { accepted: 0, rejected: 0 },
        endpointStats: seed.endpointStats || {},
        cancelled: seed.cancelled || false,
        generation: seed.generation || 0
    };
}

/**
 * Snapshot for UI: reason, next retry, cancel affordance.
 */
export function uiSnapshot(state) {
    return {
        phase: state.phase,
        reason: state.reason,
        nextRetryAt: state.nextRetryAt,
        attempt: state.attempt,
        maxAttempts: state.maxAttempts,
        autoReconnect: state.autoReconnect,
        canCancel: state.phase === 'reconnecting' || state.phase === 'failover',
        activeEndpointId: state.activeEndpointId,
        classification: state.lastClassification
    };
}

/**
 * Begin a mining session with a primary endpoint.
 */
export function beginSession(state, { endpointId, profileRevision, at } = {}) {
    return {
        ...state,
        phase: 'mining',
        attempt: 0,
        reason: null,
        nextRetryAt: null,
        cancelled: false,
        activeEndpointId: endpointId || state.activeEndpointId,
        primaryEndpointId: endpointId || state.primaryEndpointId,
        profileRevision: profileRevision ?? state.profileRevision,
        generation: state.generation + 1,
        lastClassification: null,
        _lastAt: at || Date.now()
    };
}

/**
 * Handle a disconnect while a session is (or was) active.
 * @returns {{ state: object, action: object }}
 * action.type: 'stop'|'pause'|'wait'|'failover'|'none'
 */
export function onDisconnect(state, event = {}) {
    const at = event.at || Date.now();
    if (state.cancelled || state.phase === 'stopped') {
        return {
            state: { ...state, phase: 'stopped', reason: state.reason || 'already stopped', nextRetryAt: null },
            action: { type: 'none' }
        };
    }

    const classification = classifyDisconnect(event);
    let next = {
        ...state,
        lastClassification: classification,
        reason: classification.label
    };

    if (classification.kind === 'pause') {
        next = { ...next, phase: 'paused', nextRetryAt: null, attempt: 0 };
        return { state: next, action: { type: 'pause', reason: classification.label } };
    }

    if (classification.kind === 'fatal' || !next.autoReconnect) {
        next = {
            ...next,
            phase: classification.code === 'user_stop' ? 'stopped' : 'failed',
            nextRetryAt: null
        };
        return {
            state: next,
            action: { type: 'stop', reason: next.autoReconnect ? classification.label : 'autoReconnect disabled' }
        };
    }

    if (!canAttempt(next, next.attempt)) {
        // Try failover before giving up
        const failOver = tryFailover(next, event, at);
        if (failOver) return failOver;

        next = { ...next, phase: 'failed', nextRetryAt: null, reason: 'reconnect attempts exhausted' };
        return { state: next, action: { type: 'stop', reason: next.reason } };
    }

    const { delayMs } = nextBackoff({
        attempt: next.attempt,
        baseMs: next.baseMs,
        maxMs: next.maxMs,
        random: event.random
    });
    next = {
        ...next,
        phase: 'reconnecting',
        attempt: next.attempt + 1,
        nextRetryAt: at + delayMs
    };
    return {
        state: next,
        action: {
            type: 'wait',
            delayMs,
            nextRetryAt: next.nextRetryAt,
            reason: classification.label,
            endpointId: next.activeEndpointId
        }
    };
}

function tryFailover(state, event, at) {
    const primary = event.primary;
    const backups = event.backups || [];
    if (!primary) return null;
    const pick = selectFailoverTarget(primary, backups, {
        failedId: state.activeEndpointId,
        cooldownIds: event.cooldownIds
    });
    if (!pick.ok) return null;
    const next = {
        ...state,
        phase: 'failover',
        attempt: 0,
        activeEndpointId: pick.endpoint.id,
        reason: `failover → ${pick.endpoint.id}`,
        nextRetryAt: at,
        endpointStats: {
            ...state.endpointStats,
            [state.activeEndpointId || 'unknown']: {
                ...(state.endpointStats[state.activeEndpointId || 'unknown'] || {}),
                lastFailAt: at
            }
        }
    };
    return {
        state: next,
        action: {
            type: 'failover',
            endpoint: pick.endpoint,
            reason: pick.reason
        }
    };
}

/**
 * Timer fired — either reconnect to same endpoint or evaluate return-to-primary.
 */
export function onRetryDue(state, event = {}) {
    const at = event.at || Date.now();
    if (state.cancelled || state.phase === 'stopped' || state.phase === 'paused') {
        return { state, action: { type: 'none' } };
    }
    if (state.phase !== 'reconnecting' && state.phase !== 'failover') {
        return { state, action: { type: 'none' } };
    }
    let endpointId = state.activeEndpointId;
    if (event.primary && state.primaryEndpointId && endpointId !== state.primaryEndpointId) {
        if (shouldReturnToPrimary({
            lastPrimaryFailAt: event.lastPrimaryFailAt,
            now: at,
            returnAfterMs: event.returnAfterMs
        })) {
            endpointId = state.primaryEndpointId;
        }
    }
    const next = {
        ...state,
        phase: 'mining',
        activeEndpointId: endpointId,
        nextRetryAt: null,
        reason: null
    };
    return {
        state: next,
        action: { type: 'reconnect', endpointId }
    };
}

/** User Stop — cancel all pending retries. */
export function onUserStop(state, at = Date.now()) {
    return {
        ...state,
        phase: 'stopped',
        cancelled: true,
        nextRetryAt: null,
        reason: 'manual stop',
        attempt: 0,
        generation: state.generation + 1,
        _lastAt: at
    };
}

/** Thermal / battery policy — pause without reconnect storm. */
export function onPolicyPause(state, reason, at = Date.now()) {
    return {
        ...state,
        phase: 'paused',
        cancelled: true,
        nextRetryAt: null,
        reason: reason || 'policy pause',
        _lastAt: at
    };
}

/** Profile / config revision changed — invalidate reconnect generation. */
export function onProfileChange(state, revision, at = Date.now()) {
    return {
        ...state,
        phase: 'stopped',
        cancelled: true,
        nextRetryAt: null,
        reason: 'profile change',
        profileRevision: revision,
        generation: state.generation + 1,
        _lastAt: at
    };
}

/** Record share stats without mixing endpoint histories. */
export function recordShare(state, { endpointId, accepted }) {
    const id = endpointId || state.activeEndpointId || 'unknown';
    const prev = state.endpointStats[id] || { accepted: 0, rejected: 0 };
    const endpointStats = {
        ...state.endpointStats,
        [id]: {
            ...prev,
            accepted: prev.accepted + (accepted ? 1 : 0),
            rejected: prev.rejected + (accepted ? 0 : 1)
        }
    };
    const sessionStats = {
        accepted: state.sessionStats.accepted + (accepted ? 1 : 0),
        rejected: state.sessionStats.rejected + (accepted ? 0 : 1)
    };
    return { ...state, endpointStats, sessionStats };
}
