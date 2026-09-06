/**
 * Bounded session history (#55).
 */

export class SessionHistory {
    /**
     * @param {number} [capacity=50]
     */
    constructor(capacity = 50) {
        this.capacity = Math.max(1, Math.min(capacity, 500));
        /** @type {any[]} */
        this.sessions = [];
    }

    /**
     * @param {object} entry
     */
    record(entry) {
        this.sessions.push({
            sessionId: entry.sessionId,
            startedAt: entry.startedAt,
            stoppedAt: entry.stoppedAt ?? null,
            stopReason: entry.stopReason ?? null,
            startReason: entry.startReason ?? 'user',
            engine: entry.engine ?? null,
            registryRevision: entry.registryRevision ?? null,
            acceptedShares: entry.acceptedShares ?? null,
            dataQuality: entry.dataQuality ?? 'unknown',
            effectiveConfigSummary: entry.effectiveConfigSummary ?? null
        });
        while (this.sessions.length > this.capacity) this.sessions.shift();
        return this.sessions.length;
    }

    last() {
        return this.sessions[this.sessions.length - 1] || null;
    }

    list() {
        return [...this.sessions];
    }

    clear() {
        this.sessions = [];
    }
}
