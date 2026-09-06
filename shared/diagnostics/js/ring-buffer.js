/**
 * Bounded ring buffer for diagnostic logs (#55).
 */

export class RingBuffer {
    /**
     * @param {number} [capacity=1000]
     */
    constructor(capacity = 1000) {
        this.capacity = Math.max(1, Math.min(Number(capacity) || 1000, 100_000));
        /** @type {any[]} */
        this.items = [];
        this.dropped = 0;
        this.followTail = true;
        this.paused = false;
    }

    /**
     * @param {object} event
     */
    push(event) {
        if (this.paused) {
            // Still record while paused so history is complete; UI just doesn't follow.
        }
        this.items.push(event);
        while (this.items.length > this.capacity) {
            this.items.shift();
            this.dropped += 1;
        }
        return this.items.length;
    }

    clear() {
        this.items = [];
        this.dropped = 0;
    }

    /**
     * @param {{ level?: string, query?: string, sessionId?: string }} [filter]
     */
    query(filter = {}) {
        const q = String(filter.query || '').toLowerCase();
        return this.items.filter((ev) => {
            if (filter.level && ev.level !== filter.level) return false;
            if (filter.sessionId && ev.sessionId !== filter.sessionId) return false;
            if (!q) return true;
            const hay = `${ev.code || ''} ${ev.message || ''} ${ev.reason || ''}`.toLowerCase();
            return hay.includes(q);
        });
    }

    size() {
        return this.items.length;
    }
}
