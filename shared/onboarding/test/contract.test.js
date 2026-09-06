/**
 * Onboarding flow tests (#56).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createOnboarding,
    goNext,
    goBack,
    skipToAdvanced,
    updateDraft,
    canStart,
    launchSummary,
    stepBlockers
} from '../js/flow.js';

test('happy path: address + verified preset reaches startable summary', () => {
    let s = createOnboarding({
        capabilities: {
            engineReady: true,
            engineName: 'randomx.js',
            coins: { monero: 'supported' },
            feesKnown: true
        }
    });
    s = goNext(s); // capability → payout
    assert.equal(s.step, 'payout');
    s = updateDraft(s, {
        coin: 'monero',
        walletAddress: '44afednaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        poolId: 'supportxmr'
    });
    s = goNext(s);
    assert.equal(s.step, 'load');
    s = goNext(s);
    assert.equal(s.step, 'summary');
    const start = canStart(s, 'user_start');
    assert.equal(start.ok, true);
    const sum = launchSummary(s);
    assert.equal(sum.engine, 'randomx.js');
    assert.match(sum.walletElided, /…/);
});

test('back keeps draft', () => {
    let s = createOnboarding({ capabilities: { engineReady: true, coins: { monero: 'supported' } } });
    s = goNext(s);
    s = updateDraft(s, { coin: 'monero', walletAddress: '4abc', poolId: 'x' });
    s = goNext(s);
    s = goBack(s);
    assert.equal(s.step, 'payout');
    assert.equal(s.draft.walletAddress, '4abc');
});

test('skip wizard preserves advanced capability (summary)', () => {
    const s = skipToAdvanced(createOnboarding());
    assert.equal(s.skippedWizard, true);
    assert.equal(s.step, 'summary');
});

test('implicit triggers cannot start', () => {
    const s = createOnboarding({
        capabilities: { engineReady: true, coins: { monero: 'supported' } },
        draft: { coin: 'monero', walletAddress: '4a', poolId: 'p', loadProfile: 'balanced' }
    });
    assert.equal(canStart(s, 'app_open').ok, false);
    assert.equal(canStart(s, 'paste_wallet').ok, false);
    assert.equal(canStart(s, 'tos_agree').ok, false);
});

test('unsupported coin and invalid wallet have actionable blockers', () => {
    const s = createOnboarding({
        step: 'payout',
        capabilities: { engineReady: true, coins: { dero: 'unavailable' } },
        draft: { coin: 'dero', walletAddress: 'bad', walletInvalid: true }
    });
    const b = stepBlockers(s);
    assert.ok(b.some((x) => x.code === 'coin_unsupported' && x.fix));
    assert.ok(b.some((x) => x.code === 'wallet_invalid' && x.fix));
});

test('draft separate from running config in summary', () => {
    const s = createOnboarding({
        draft: { coin: 'monero', walletAddress: '4new', poolId: 'a', threads: 2 },
        running: { active: false, config: { coin: 'monero', walletAddress: '4old', poolId: 'a', threads: 1 } }
    });
    assert.equal(launchSummary(s).draftSeparateFromRunning, true);
});
