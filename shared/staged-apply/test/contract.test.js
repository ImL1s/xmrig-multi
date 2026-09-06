/**
 * Staged apply contract tests (#57).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    fieldCatalog,
    stageApply,
    commitApply,
    validateExpertArgs,
    mergeTunerUpdate
} from '../js/stage.js';

test('catalog marks msr unsupported unless engine capability set', () => {
    assert.equal(fieldCatalog().msr.applyMode, 'unsupported');
    assert.equal(fieldCatalog({ msr: true }).msr.applyMode, 'restart');
});

test('stageApply separates hot vs restart and redacts wallet', () => {
    const plan = stageApply({
        effective: { threads: 2, autoReconnect: true, walletAddress: '44abcde999walletXXXX' },
        draft: { threads: 4, autoReconnect: false, walletAddress: '44abcde999walletYYYY' },
        runningRevision: 3
    });
    assert.equal(plan.dirty, true);
    assert.equal(plan.needsRestart, true);
    assert.equal(plan.savedButNotEffective, true);
    assert.ok(plan.hot.some((f) => f.key === 'autoReconnect'));
    assert.ok(plan.restart.some((f) => f.key === 'threads'));
    const wallet = plan.fields.find((f) => f.key === 'walletAddress');
    assert.ok(wallet);
    assert.match(String(wallet.from), /…/);
    assert.doesNotMatch(String(wallet.from), /walletXXXX/);
});

test('locked fields block apply; tuner cannot overwrite locks', () => {
    const plan = stageApply({
        effective: { threads: 2 },
        draft: { threads: 8 },
        lockedFields: ['threads']
    });
    assert.equal(plan.ok, false);
    assert.equal(plan.blocked.length, 1);

    const merged = mergeTunerUpdate({ threads: 2, yield: true }, { threads: 16, yield: false }, ['threads']);
    assert.equal(merged.config.threads, 2);
    assert.equal(merged.config.yield, false);
    assert.deepEqual(merged.skipped, ['threads']);
});

test('reentry blocked while applying', () => {
    const plan = stageApply({
        applying: true,
        effective: { threads: 1 },
        draft: { threads: 2 }
    });
    assert.equal(plan.reentryBlocked, true);
    const commit = commitApply(plan, { success: true });
    assert.equal(commit.applied, false);
});

test('failed apply restores last-known-good but keeps draft flag', () => {
    const plan = stageApply({
        effective: { threads: 2 },
        draft: { threads: 4 },
        lastKnownGood: { threads: 2 }
    });
    const result = commitApply(plan, { success: false, reason: 'engine rejected' });
    assert.equal(result.applied, false);
    assert.equal(result.engine.threads, 2);
    assert.equal(result.draftPreserved, true);
});

test('expert argv allowlist + negative tests', () => {
    assert.equal(validateExpertArgs({ argv: ['--threads=4', '--yield'] }).ok, true);

    const shell = validateExpertArgs({ argv: ['--threads=4; rm -rf /'] });
    assert.equal(shell.ok, false);

    const unknown = validateExpertArgs({ argv: ['--not-a-real-flag'] });
    assert.equal(unknown.ok, false);

    const donate = validateExpertArgs({ argv: ['--donate-level=0'] });
    assert.equal(donate.ok, false);

    const dup = validateExpertArgs({ argv: ['--threads=2', '--threads=4'] });
    assert.equal(dup.ok, false);

    const json = validateExpertArgs({ json: { 'donate-level': 0, pools: [] } });
    assert.equal(json.ok, false);
});

test('unsupported customShellArgs never hot-applies', () => {
    const plan = stageApply({
        effective: {},
        draft: { customShellArgs: '--threads 2' }
    });
    assert.ok(plan.unsupported.some((f) => f.key === 'customShellArgs'));
});
