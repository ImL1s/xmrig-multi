/**
 * Conservative recommender over HardwareSnapshot (#33).
 * Does not auto-tune; only safe defaults + confidence + reasons.
 * RandomX mode hint uses shared/randomx-memory select (#35).
 */

import { selectRandomXMode } from '../../randomx-memory/js/select.js';

/**
 * @param {object} snapshot validated HardwareSnapshot
 * @returns {{
 *   recommendedThreads: number,
 *   maxThreads: number,
 *   randomxModeHint: 'auto'|'light'|'fast',
 *   confidence: 'high'|'medium'|'low'|'unknown',
 *   reasons: string[],
 *   affinitySafe: boolean,
 *   staleIf: string[]
 * }}
 */
export function recommendFromHardware(snapshot) {
    const reasons = [];
    const logical = snapshot?.cpu?.logical?.value;
    const physical = snapshot?.cpu?.physical?.value;
    const allowed = snapshot?.cpu?.allowed?.value;
    const memAvail = snapshot?.memory?.availableBytes?.value;
    const memTotal = snapshot?.memory?.totalBytes?.value;
    const abiOk = snapshot?.engine?.abiSupported?.value;

    if (abiOk === false) {
        return {
            recommendedThreads: 0,
            maxThreads: 0,
            randomxModeHint: 'light',
            confidence: 'high',
            reasons: ['ABI unsupported for this engine binary'],
            affinitySafe: false,
            staleIf: [...(snapshot.invalidationHints || [])]
        };
    }

    let maxThreads = 1;
    if (Number.isInteger(allowed) && allowed >= 1) {
        maxThreads = allowed;
        reasons.push(`cap to allowed CPUs (${allowed})`);
    } else if (Number.isInteger(logical) && logical >= 1) {
        maxThreads = logical;
        reasons.push(`cap to logical CPUs (${logical}); allowed unknown`);
    } else {
        reasons.push('CPU count unknown — conservative single thread');
        maxThreads = 1;
    }

    // Prefer leaving one logical free when we have headroom.
    let recommended = maxThreads >= 2 ? maxThreads - 1 : 1;
    if (Number.isInteger(physical) && physical >= 1 && physical < recommended) {
        // Prefer physical when SMT unknown or heterogeneous — safer heat/cache.
        if (snapshot.cpu.smt?.value === true || snapshot.cpu.heterogeneous?.value === true) {
            recommended = Math.max(1, physical);
            reasons.push('heterogeneous/SMT: prefer physical core count');
        }
    }

    const mem = Number.isInteger(memAvail) ? memAvail : memTotal;
    const rxSel = selectRandomXMode({
        algorithm: 'rx/0',
        requestedMode: 'auto',
        threads: recommended,
        availableBytes: Number.isInteger(memAvail) ? memAvail : null,
        totalBytes: Number.isInteger(memTotal) ? memTotal : null,
        processLimitBytes: snapshot?.memory?.processLimitBytes?.value ?? null
    });
    const randomxModeHint = rxSel.appliedMode === 'fast' ? 'auto' : (rxSel.appliedMode || 'light');
    for (const r of rxSel.reasons.slice(0, 3)) reasons.push(r);
    if (mem == null) {
        reasons.push('memory unknown — RandomX light until probed (#35)');
    }

    const confParts = [
        snapshot?.cpu?.logical?.confidence,
        snapshot?.cpu?.allowed?.confidence,
        snapshot?.memory?.availableBytes?.confidence || snapshot?.memory?.totalBytes?.confidence
    ].filter(Boolean);
    const confidence = worstConfidence(confParts);

    const affinitySafe = Number.isInteger(allowed)
        && snapshot.cpu.allowed.confidence !== 'unknown'
        && (allowed <= (logical || allowed));

    if (!affinitySafe) {
        reasons.push('affinity binding unsafe until allowed set is known');
    }

    return {
        recommendedThreads: recommended,
        maxThreads,
        randomxModeHint,
        confidence,
        reasons,
        affinitySafe,
        staleIf: [...(snapshot.invalidationHints || ['cpuset-change', 'hotplug', 'power-source-change'])]
    };
}

function worstConfidence(list) {
    const rank = { unknown: 0, low: 1, medium: 2, high: 3 };
    let worst = 'high';
    for (const c of list) {
        if ((rank[c] ?? 0) < (rank[worst] ?? 0)) worst = c;
    }
    if (!list.length) return 'unknown';
    return worst;
}
