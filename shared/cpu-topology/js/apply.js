/**
 * Apply affinity profile → XMRig argv / config fragments (#36).
 */

import { affinityCapability } from './platform.js';
import { idsToMaskHex, validateAffinity } from './affinity.js';

/**
 * @param {object} opts
 * @param {object} opts.snapshot
 * @param {'os-auto'|string} [opts.candidateId]
 * @param {number[]|string|null} [opts.manualCpuIds]
 * @param {boolean} [opts.applyFailed] simulate OS apply failure
 */
export function resolveAffinityApply(opts = {}) {
    const snapshot = opts.snapshot || {};
    const os = snapshot?.platform?.os;
    const cap = affinityCapability(os);
    const warnings = [];
    const errors = [];

    if (opts.candidateId === 'os-auto' || (!opts.candidateId && opts.manualCpuIds == null)) {
        return {
            ok: true,
            applied: 'os-auto',
            cpuIds: null,
            argv: [],
            configCpu: {},
            warnings: [`baseline OS auto (${cap.mode})`],
            errors: [],
            verifiedReadback: false,
            readbackNote: 'OS auto has no affinity readback'
        };
    }

    if (!cap.canEmitXmrigAffinity) {
        return {
            ok: true,
            applied: 'os-auto',
            cpuIds: null,
            argv: [],
            configCpu: {},
            warnings: [
                ...cap.reasons,
                'requested affinity ignored — fell back to OS auto (no root escalation)'
            ],
            errors: [],
            verifiedReadback: false,
            readbackNote: 'platform cannot apply hard affinity'
        };
    }

    const source = opts.manualCpuIds != null
        ? opts.manualCpuIds
        : opts.cpuIds;

    if (source == null) {
        return {
            ok: true,
            applied: 'os-auto',
            cpuIds: null,
            argv: [],
            configCpu: {},
            warnings: ['no cpu ids on candidate — OS auto'],
            errors: [],
            verifiedReadback: false,
            readbackNote: 'n/a'
        };
    }

    const validated = validateAffinity(snapshot, source, { allowNormalize: true });
    if (!validated.ok) {
        return {
            ok: false,
            applied: 'os-auto',
            cpuIds: null,
            argv: [],
            configCpu: {},
            warnings: ['affinity rejected — OS auto fallback'],
            errors: validated.errors,
            verifiedReadback: false,
            readbackNote: 'not applied'
        };
    }
    warnings.push(...validated.warnings);

    if (opts.applyFailed) {
        return {
            ok: true,
            applied: 'os-auto',
            cpuIds: null,
            argv: [],
            configCpu: {},
            warnings: [
                ...warnings,
                'affinity apply failed at OS boundary — reverted to OS auto (not reported as success bind)'
            ],
            errors: [],
            verifiedReadback: false,
            readbackNote: 'apply failed'
        };
    }

    const mask = idsToMaskHex(validated.ids);
    /** @type {string[]} */
    const argv = [];
    /** @type {Record<string, unknown>} */
    const configCpu = {};

    if (mask && !mask.preferIdList) {
        argv.push(`--cpu-affinity=${mask.hex}`);
        configCpu.affinity = mask.hex;
    } else {
        // Multi-word / >64: prefer rx thread list in config (CPU ids), not a truncated 32-bit mask.
        configCpu['rx/0'] = validated.ids;
        warnings.push('>64 or multi-word affinity uses config cpu id list, not a single 32-bit mask');
    }

    return {
        ok: true,
        applied: 'affinity',
        cpuIds: validated.ids,
        argv,
        configCpu,
        warnings,
        errors,
        verifiedReadback: false,
        readbackNote: 'readback unverified unless platform reports effective mask'
    };
}
