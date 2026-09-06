/**
 * Topology-aware affinity candidates (#36).
 * Baseline is always OS auto. Does not claim P-only or SMT-off is faster.
 */

import { affinityCapability } from './platform.js';
import { allowedUniverse } from './affinity.js';

/**
 * @param {object} snapshot
 * @returns {{
 *   candidates: Array<{
 *     id: string,
 *     label: string,
 *     mode: 'os-auto'|'affinity',
 *     threads: number,
 *     cpuIds: number[]|null,
 *     groupKind: string|null,
 *     measurable: boolean,
 *     notes: string[]
 *   }>,
 *   affinity: ReturnType<typeof affinityCapability>,
 *   reasons: string[]
 * }}
 */
export function buildTopologyCandidates(snapshot) {
    const os = snapshot?.platform?.os || 'unknown';
    const affinity = affinityCapability(os);
    const { logicalMax, allowedIds, onlineIds } = allowedUniverse(snapshot);
    const allowed = allowedIds || onlineIds;
    const physical = Number(snapshot?.cpu?.physical?.value);
    const groups = Array.isArray(snapshot?.cpu?.coreGroups?.value)
        ? snapshot.cpu.coreGroups.value
        : [];
    const reasons = [];
    /** @type {any[]} */
    const candidates = [];

    const push = (c) => {
        if (candidates.some((x) => x.id === c.id)) return;
        candidates.push(c);
    };

    push({
        id: 'os-auto',
        label: 'OS scheduler (baseline)',
        mode: 'os-auto',
        threads: Math.max(1, allowed.length),
        cpuIds: null,
        groupKind: null,
        measurable: true,
        notes: ['No hard affinity; lets OS place workers']
    });

    // One thread per allowed logical (SMT on if present)
    push({
        id: 'smt-all-allowed',
        label: 'All allowed logical CPUs',
        mode: affinity.canEmitXmrigAffinity ? 'affinity' : 'os-auto',
        threads: Math.max(1, allowed.length),
        cpuIds: affinity.canEmitXmrigAffinity ? [...allowed] : null,
        groupKind: 'logical',
        measurable: true,
        notes: affinity.canEmitXmrigAffinity
            ? ['Bind to full allowed set']
            : ['Affinity not emitted on this platform — thread count only']
    });

    // Prefer physical count when known and SMT true
    if (Number.isInteger(physical) && physical >= 1 && physical < allowed.length) {
        const physIds = pickEvenStride(allowed, physical);
        push({
            id: 'physical-stride',
            label: 'One worker per physical (stride heuristic)',
            mode: affinity.canEmitXmrigAffinity ? 'affinity' : 'os-auto',
            threads: physIds.length,
            cpuIds: affinity.canEmitXmrigAffinity ? physIds : null,
            groupKind: 'physical',
            measurable: true,
            notes: [
                'Heuristic stride — not a guarantee of true SMT siblings',
                'Do not assume this is faster than OS auto'
            ]
        });
        reasons.push('SMT/physical candidate from physical count');
    }

    for (const g of groups) {
        const ids = (g.logicalIds || []).filter((id) => allowed.includes(id));
        if (!ids.length) continue;
        const kind = String(g.kind || 'group');
        const label = g.label || kind;
        push({
            id: `group-${kind}-${label}`.replace(/\s+/g, '-').toLowerCase(),
            label: `Group ${label} (${kind})`,
            mode: affinity.canEmitXmrigAffinity ? 'affinity' : 'os-auto',
            threads: ids.length,
            cpuIds: affinity.canEmitXmrigAffinity ? ids : null,
            groupKind: kind,
            measurable: true,
            notes: [
                `Topology group from snapshot (${kind})`,
                'Candidate only — not declared optimal'
            ]
        });
    }

    // NUMA hint: if numaNodes > 1 but no groups, keep OS auto note
    const numa = snapshot?.cpu?.numaNodes?.value;
    if (Number.isInteger(numa) && numa > 1 && !groups.length) {
        reasons.push(`NUMA nodes=${numa} but no per-node groups — keep OS auto as baseline`);
    }

    if (!affinity.canEmitXmrigAffinity) {
        reasons.push(...affinity.reasons);
    }

    reasons.push(`universe logicalMax=${logicalMax}, allowed=${allowed.length}`);

    return { candidates, affinity, reasons };
}

/**
 * Pick `count` ids with even stride across allowed list.
 * @param {number[]} allowed
 * @param {number} count
 */
function pickEvenStride(allowed, count) {
    if (count >= allowed.length) return [...allowed];
    const out = [];
    for (let i = 0; i < count; i++) {
        const idx = Math.min(allowed.length - 1, Math.floor((i * allowed.length) / count));
        out.push(allowed[idx]);
    }
    return [...new Set(out)].sort((a, b) => a - b);
}
