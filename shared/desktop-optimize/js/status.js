/**
 * Requested vs effective optimize status (#37).
 */

import { capabilityMatrix, isToggleable } from './matrix.js';

/**
 * @param {object} opts
 * @param {string} opts.os
 * @param {Record<string, boolean|number|null|undefined>} [opts.requested]
 * @param {Record<string, { ok?: boolean, ratio?: number|null, reason?: string }>} [opts.probed]
 */
export function resolveOptimizeStatus(opts = {}) {
    const matrix = capabilityMatrix(opts.os);
    const requested = opts.requested || {};
    const probed = opts.probed || {};
    /** @type {Record<string, any>} */
    const fields = {};

    for (const [key, cap] of Object.entries(matrix)) {
        const req = requested[key];
        const want = req === true || req === 1 || req === 'on';
        const probe = probed[key] || {};
        let effective = 'off';
        const reasons = [...cap.reasons];

        if (!isToggleable(cap.state)) {
            if (want) reasons.push('requested but unsupported on this OS — ignored');
            effective = 'unsupported';
        } else if (!want) {
            effective = 'off';
        } else if (cap.state === 'needs-privilege' && probe.ok !== true) {
            effective = 'fallback';
            reasons.push(probe.reason || 'privilege denied or not consented — conservative fallback');
        } else if (probe.ok === false) {
            effective = 'fallback';
            reasons.push(probe.reason || 'allocation/apply failed — fallback');
        } else if (probe.ok === true) {
            effective = 'on';
            if (probe.ratio != null && probe.ratio < 1) {
                reasons.push(`partial success ratio=${probe.ratio}`);
            }
        } else {
            effective = 'requested';
            reasons.push('awaiting probe/apply');
        }

        fields[key] = {
            capability: cap.state,
            label: cap.label,
            requested: want,
            effective,
            toggleable: isToggleable(cap.state),
            ratio: probe.ratio ?? null,
            reasons
        };
    }

    return { os: opts.os, fields };
}
