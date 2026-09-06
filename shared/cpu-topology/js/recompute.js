/**
 * Hotplug / cpuset change recompute (#36).
 * Keeps the user profile intent and reports what changed.
 */

import { buildTopologyCandidates } from './candidates.js';
import { validateAffinity } from './affinity.js';

/**
 * @param {object} opts
 * @param {object} opts.previousSnapshot
 * @param {object} opts.nextSnapshot
 * @param {{ mode: 'os-auto'|'affinity', cpuIds?: number[]|null, candidateId?: string }} opts.profile
 */
export function recomputeAffinityProfile(opts) {
    const prev = opts.previousSnapshot;
    const next = opts.nextSnapshot;
    const profile = opts.profile || { mode: 'os-auto' };
    const nextCandidates = buildTopologyCandidates(next);
    const prevAllowed = prev?.cpu?.allowed?.value;
    const nextAllowed = next?.cpu?.allowed?.value;
    const diffs = [];

    if (prevAllowed !== nextAllowed) {
        diffs.push(`allowed ${prevAllowed} → ${nextAllowed}`);
    }
    const prevLogical = prev?.cpu?.logical?.value;
    const nextLogical = next?.cpu?.logical?.value;
    if (prevLogical !== nextLogical) {
        diffs.push(`logical ${prevLogical} → ${nextLogical}`);
    }

    if (profile.mode === 'os-auto' || !profile.cpuIds?.length) {
        return {
            profile: { ...profile, mode: 'os-auto', cpuIds: null },
            stillValid: true,
            diffs,
            candidates: nextCandidates.candidates,
            warnings: diffs.length ? [`topology changed: ${diffs.join(', ')}; OS auto retained`] : []
        };
    }

    const validated = validateAffinity(next, profile.cpuIds, { allowNormalize: true });
    if (!validated.ok) {
        return {
            profile: {
                mode: 'os-auto',
                cpuIds: null,
                candidateId: 'os-auto',
                previousCandidateId: profile.candidateId || null
            },
            stillValid: false,
            diffs,
            candidates: nextCandidates.candidates,
            warnings: [
                `affinity profile no longer valid after topology change (${validated.errors.join('; ')})`,
                'fell back to OS auto; original profile intent preserved in previousCandidateId'
            ]
        };
    }

    const normalized = validated.normalized || validated.ids.length !== profile.cpuIds.length;
    return {
        profile: {
            mode: 'affinity',
            cpuIds: validated.ids,
            candidateId: profile.candidateId || 'manual',
            normalized
        },
        stillValid: true,
        diffs,
        candidates: nextCandidates.candidates,
        warnings: [
            ...(normalized ? ['affinity ids normalized to new allowed set'] : []),
            ...(diffs.length ? [`topology changed: ${diffs.join(', ')}`] : [])
        ]
    };
}
