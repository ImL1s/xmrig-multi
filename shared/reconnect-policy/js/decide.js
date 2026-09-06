/**
 * Decide whether to schedule a reconnect (#43).
 */

import { classifyFailure } from './classify.js';
import { nextBackoffMs } from './backoff.js';

/**
 * @param {object} input
 * @param {boolean} [input.autoReconnect]
 * @param {number} [input.attempt]
 * @param {number} [input.maxAttempts]
 * @param {object} [input.error]
 * @param {boolean} [input.cancelled]
 * @param {boolean} [input.userStopped]
 * @param {boolean} [input.thermalCritical]
 * @param {boolean} [input.profileChanged]
 * @param {object} [input.backoff]
 * @param {number} [input.now]
 */
export function decideReconnect(input = {}) {
    const now = input.now ?? Date.now();
    const attempt = input.attempt ?? 0;
    const maxAttempts = input.maxAttempts ?? 5;

    if (input.autoReconnect === false) {
        return decision('stop', 'autoReconnect disabled', null, attempt);
    }
    if (input.userStopped || input.cancelled) {
        return decision('stop', 'user cancelled or stopped', null, attempt);
    }
    if (input.thermalCritical) {
        return decision('stop', 'thermal critical — no reconnect', null, attempt);
    }
    if (input.profileChanged) {
        return decision('stop', 'profile changed — cancel stale retries', null, attempt);
    }

    const classified = classifyFailure(input.error || {});
    if (!classified.retryable) {
        return decision('stop', classified.reason, null, attempt, classified.class);
    }
    if (attempt >= maxAttempts) {
        return decision('exhausted', 'retry budget exhausted', null, attempt, classified.class);
    }

    const delayMs = nextBackoffMs({
        attempt,
        ...(input.backoff || {})
    });
    return {
        action: 'retry',
        reason: classified.reason,
        class: classified.class,
        attempt,
        nextAttempt: attempt + 1,
        delayMs,
        retryAt: now + delayMs,
        cancelled: false
    };
}

function decision(action, reason, delayMs, attempt, failureClass = null) {
    return {
        action,
        reason,
        class: failureClass,
        attempt,
        nextAttempt: attempt,
        delayMs,
        retryAt: null,
        cancelled: action === 'stop'
    };
}
