/**
 * In-process fake miner for pressure / isolation tests (#49).
 */

import {
    ownsGeneration,
    applyIfOwner,
    beginSessionOwner,
    mayClearSession
} from './ownership.js';

export function createFakeMiner(opts = {}) {
    let generation = 0;
    let running = false;
    let processAlive = false;
    let stats = { hashrate: 0, uptime: 0 };
    let httpPort = opts.port || 37420;
    let hasToken = false;
    const timers = new Set();
    const pollers = new Set();

    function scheduleInterval(fn, ms) {
        const id = setInterval(fn, ms);
        pollers.add(id);
        return id;
    }

    function clearAll() {
        for (const id of timers) clearTimeout(id);
        timers.clear();
        for (const id of pollers) clearInterval(id);
        pollers.clear();
    }

    return {
        getState() {
            return {
                running,
                processAlive,
                httpPort,
                hasToken,
                stats: { ...stats },
                activePollers: pollers.size,
                activeTimers: timers.size,
                generation
            };
        },
        async start(config = {}) {
            if (running) throw new Error('already running');
            const begun = beginSessionOwner({ generation, value: stats }, { hashrate: 0, uptime: 0 });
            generation = begun.generation;
            stats = begun.value;
            running = true;
            processAlive = true;
            hasToken = true;
            httpPort = config.port || httpPort;
            if (opts.portOccupied?.has(httpPort)) {
                httpPort += 1;
            }
            const gen = generation;
            scheduleInterval(() => {
                if (!ownsGeneration(gen, generation)) return;
                if (opts.apiStuck) return;
                const r = applyIfOwner(
                    { generation, value: stats },
                    gen,
                    (v) => ({ ...v, hashrate: 100 + gen, uptime: (v.uptime || 0) + 1 })
                );
                if (r.applied) stats = r.value;
            }, opts.pollMs || 10);
            scheduleInterval(() => {
                if (!mayClearSession(gen, generation, processAlive)) return;
                if (!processAlive && ownsGeneration(gen, generation)) {
                    running = false;
                    stats = { hashrate: 0, uptime: 0 };
                }
            }, opts.reapMs || 10);
            return { generation: gen, httpPort, tokenPresent: true };
        },
        async stop() {
            const gen = generation;
            generation += 1;
            clearAll();
            if (opts.refuseKill) {
                running = false;
                return { stopped: false, refused: true, generation: gen };
            }
            processAlive = false;
            running = false;
            hasToken = false;
            stats = { hashrate: 0, uptime: 0 };
            return { stopped: true, generation: gen };
        },
        injectStaleStats(eventGen, patch) {
            const r = applyIfOwner({ generation, value: stats }, eventGen, (v) => ({ ...v, ...patch }));
            if (r.applied) stats = r.value;
            return r.applied;
        },
        forceKill() {
            processAlive = false;
            running = false;
            hasToken = false;
            clearAll();
        },
        dispose() {
            clearAll();
            processAlive = false;
            running = false;
        }
    };
}
