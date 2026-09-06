/**
 * Desktop optimize contract tests (#37).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityMatrix, isToggleable } from '../js/matrix.js';
import { resolveOptimizeStatus } from '../js/status.js';
import { planOptimizeApply } from '../js/apply.js';

test('platform matrix hides Linux-only 1GB pages on macOS/Windows', () => {
    assert.equal(capabilityMatrix('macos').pages1g.state, 'unsupported');
    assert.equal(capabilityMatrix('windows').pages1g.state, 'unsupported');
    assert.ok(isToggleable(capabilityMatrix('linux').pages1g.state));
    assert.equal(capabilityMatrix('macos').hugePages.state, 'unsupported');
    assert.equal(capabilityMatrix('macos').msr.state, 'unsupported');
});

test('requested unsupported fields become effective unsupported', () => {
    const st = resolveOptimizeStatus({
        os: 'windows',
        requested: { pages1g: true, hugePages: true },
        probed: { hugePages: { ok: false, reason: 'SeLockMemoryPrivilege missing' } }
    });
    assert.equal(st.fields.pages1g.effective, 'unsupported');
    assert.equal(st.fields.pages1g.toggleable, false);
    assert.equal(st.fields.hugePages.effective, 'fallback');
    assert.ok(st.fields.hugePages.reasons.some((r) => /privilege|fallback/i.test(r)));
});

test('privilege denial and huge-page fail stay conservative', () => {
    const plan = planOptimizeApply({
        os: 'linux',
        requested: { hugePages: true, pages1g: true, priority: 'normal' },
        probed: {
            hugePages: { ok: false, reason: 'nr_hugepages=0' },
            pages1g: { ok: false, reason: 'no 1G pool' }
        }
    });
    assert.ok(plan.ok);
    assert.ok(!plan.argv.includes('--huge-pages'));
    assert.ok(!plan.argv.includes('--randomx-1gb-pages'));
    assert.equal(plan.elevated, false);
});

test('MSR requires consent and is blocked for auto-tuner', () => {
    const noConsent = planOptimizeApply({
        os: 'linux',
        requested: { msr: true },
        msrConsent: false
    });
    assert.equal(noConsent.ok, false);
    assert.ok(noConsent.errors.some((e) => /consent/i.test(e)));

    const tuner = planOptimizeApply({
        os: 'linux',
        requested: { msr: true, hugePages: true },
        msrConsent: true,
        autoTuner: true,
        probed: { hugePages: { ok: true } }
    });
    assert.ok(tuner.warnings.some((w) => /auto-tuner ignored/i.test(w)));
    assert.ok(!tuner.steps.some((s) => s.action === 'msr-apply'));
});

test('MSR consent records restore plan and warns crash is best-effort', () => {
    const plan = planOptimizeApply({
        os: 'linux',
        requested: { msr: true },
        msrConsent: true,
        probed: { msr: { ok: true, original: '0x1' } }
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.msrRestore.length, 1);
    assert.equal(plan.msrRestore[0].original, '0x1');
    assert.ok(plan.warnings.some((w) => /best-effort/i.test(w)));
});

test('priority never defaults to highest/realtime', () => {
    const plan = planOptimizeApply({
        os: 'windows',
        requested: { priority: 'realtime' }
    });
    assert.equal(plan.priority, 'normal');
    assert.ok(plan.errors.some((e) => /blocked/i.test(e)) || plan.warnings.length);
});

test('yield false emits --cpu-no-yield; default stays yielding', () => {
    const off = planOptimizeApply({ os: 'linux', requested: { yield: false } });
    assert.ok(off.argv.includes('--cpu-no-yield'));
    const def = planOptimizeApply({ os: 'linux', requested: {} });
    assert.ok(!def.argv.includes('--cpu-no-yield'));
});

test('successful huge pages + numa produce argv without elevation', () => {
    const plan = planOptimizeApply({
        os: 'linux',
        requested: { hugePages: true, numa: true, yield: true },
        probed: { hugePages: { ok: true, ratio: 1 } }
    });
    assert.ok(plan.argv.includes('--huge-pages'));
    assert.ok(plan.argv.includes('--numa'));
    assert.equal(plan.elevated, false);
});
