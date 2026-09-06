/**
 * Session ownership helpers (#49).
 * Old poller/reaper/worker events must not mutate a newer session.
 */

/**
 * @param {number|bigint} eventGeneration
 * @param {number|bigint} currentGeneration
 */
export function ownsGeneration(eventGeneration, currentGeneration) {
    return Number(eventGeneration) === Number(currentGeneration) && Number(currentGeneration) > 0;
}

/**
 * Apply an update only when the event still owns the live generation.
 * @template T
 * @param {{ generation: number, value: T }} state
 * @param {number} eventGeneration
 * @param {(prev: T) => T} updater
 * @returns {{ generation: number, value: T, applied: boolean }}
 */
export function applyIfOwner(state, eventGeneration, updater) {
    if (!ownsGeneration(eventGeneration, state.generation)) {
        return { ...state, applied: false };
    }
    return {
        generation: state.generation,
        value: updater(state.value),
        applied: true
    };
}

/**
 * Bump generation and reset value for a new session start.
 * @template T
 * @param {{ generation: number, value: T }} state
 * @param {T} initialValue
 */
export function beginSessionOwner(state, initialValue) {
    const generation = (Number(state.generation) || 0) + 1;
    return { generation, value: initialValue, applied: true };
}

/**
 * Stale delayed clear must not wipe a newer session's stats.
 * @param {number} eventGeneration
 * @param {number} currentGeneration
 * @param {boolean} stillRunning
 */
export function mayClearSession(eventGeneration, currentGeneration, stillRunning) {
    if (stillRunning) return false;
    return ownsGeneration(eventGeneration, currentGeneration);
}
