/**
 * Safe apply plan for desktop optimize (#37).
 * Never auto-elevates. MSR requires explicit consent + restore plan.
 */

import { capabilityMatrix } from './matrix.js';
import { resolveOptimizeStatus } from './status.js';

const SAFE_PRIORITIES = new Set(['idle', 'below_normal', 'normal', 'above_normal']);

/**
 * @param {object} opts
 * @param {string} opts.os
 * @param {Record<string, any>} [opts.requested]
 * @param {boolean} [opts.msrConsent]
 * @param {boolean} [opts.autoTuner]
 * @param {Record<string, any>} [opts.probed]
 */
export function planOptimizeApply(opts = {}) {
    const matrix = capabilityMatrix(opts.os);
    const requested = { ...(opts.requested || {}) };
    const warnings = [];
    const errors = [];
    /** @type {string[]} */
    const argv = [];
    /** @type {Array<{ action: string, reversible: boolean, note: string }>} */
    const steps = [];
    /** @type {Array<{ register: string, original: string|null, restore: string }>} */
    const msrRestore = [];

    if (opts.autoTuner) {
        // Strip privilege-gated requests from tuner
        for (const key of ['hugePages', 'pages1g', 'msr']) {
            if (requested[key]) {
                warnings.push(`auto-tuner ignored privileged request: ${key}`);
                requested[key] = false;
            }
        }
    }

    // Priority: never realtime/highest by default
    let priority = requested.priority ?? 'normal';
    if (typeof priority === 'boolean') priority = priority ? 'above_normal' : 'normal';
    if (priority === 'highest' || priority === 'realtime') {
        errors.push(`priority ${priority} blocked — choose from ${[...SAFE_PRIORITIES].join(',')}`);
        priority = 'normal';
        warnings.push('fell back to normal priority');
    }
    if (!SAFE_PRIORITIES.has(String(priority))) {
        warnings.push(`unknown priority ${priority} → normal`);
        priority = 'normal';
    }
    if (priority !== 'normal' && matrix.priority.state !== 'unsupported') {
        steps.push({
            action: `set-priority:${priority}`,
            reversible: true,
            note: 'restore to normal on stop'
        });
    }

    if (requested.yield === false) {
        argv.push('--cpu-no-yield');
        steps.push({
            action: 'cpu-no-yield',
            reversible: true,
            note: 'default yield=true is safer for interactive desktops'
        });
    }

    if (requested.hugePages && matrix.hugePages.state !== 'unsupported') {
        if (opts.probed?.hugePages?.ok) {
            argv.push('--huge-pages');
            steps.push({
                action: 'huge-pages-use',
                reversible: true,
                note: 'uses already available pages; does not sysctl'
            });
        } else {
            warnings.push('huge pages requested but not available — continue without');
        }
    }

    if (requested.pages1g) {
        if (matrix.pages1g.state === 'unsupported') {
            warnings.push('1GB pages unsupported on this OS — switch hidden/ignored');
        } else if (opts.probed?.pages1g?.ok) {
            argv.push('--randomx-1gb-pages');
        } else {
            warnings.push('1GB pages not ready (boot/sysctl) — fallback without modifying system');
        }
    }

    if (requested.numa && matrix.numa.state === 'available') {
        argv.push('--numa');
        steps.push({ action: 'numa', reversible: true, note: 'XMRig NUMA awareness' });
    }

    if (requested.msr) {
        if (matrix.msr.state === 'unsupported') {
            warnings.push('MSR unsupported — ignored');
        } else if (!opts.msrConsent) {
            errors.push('MSR requires explicit consent');
        } else if (opts.autoTuner) {
            errors.push('auto-tuner must not enable MSR');
        } else {
            msrRestore.push({
                register: 'IA32_MISC_ENABLE',
                original: opts.probed?.msr?.original ?? null,
                restore: 'write-recorded-original-on-stop-or-crash-best-effort'
            });
            steps.push({
                action: 'msr-apply',
                reversible: true,
                note: 'crash may prevent restore — user was warned; not absolutely safe'
            });
            warnings.push('MSR restore after hard crash is best-effort only');
        }
    }

    const status = resolveOptimizeStatus({
        os: opts.os,
        requested: {
            hugePages: !!requested.hugePages,
            pages1g: !!requested.pages1g,
            numa: !!requested.numa,
            msr: !!requested.msr && !!opts.msrConsent && !opts.autoTuner,
            priority: priority !== 'normal',
            yield: requested.yield === false
        },
        probed: opts.probed
    });

    return {
        ok: errors.length === 0,
        argv,
        steps,
        msrRestore,
        priority,
        warnings,
        errors,
        status,
        elevated: false
    };
}
