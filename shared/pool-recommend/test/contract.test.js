import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistry } from '../../pool-registry/js/load.js';
import {
    hashrateBand,
    estimateShareWait,
    recommendPools,
    firstShareStatus,
    scoreEndpoint
} from '../js/recommend.js';

test('hashrate bands: unknown / low 3-5 H/s / mid / high', () => {
    assert.equal(hashrateBand(null), 'unknown');
    assert.equal(hashrateBand(0), 'unknown');
    assert.equal(hashrateBand(3), 'low');
    assert.equal(hashrateBand(5), 'low');
    assert.equal(hashrateBand(100), 'mid');
    assert.equal(hashrateBand(5000), 'high');
});

test('share wait D/H model is deterministic; unknown inputs fail closed', () => {
    const ok = estimateShareWait({ difficulty: 1000, hashrateHs: 10 });
    assert.equal(ok.ok, true);
    assert.equal(ok.expectedSeconds, 100);
    assert.ok(Math.abs(ok.p50Seconds - 100 * Math.LN2) < 1e-9);
    assert.ok(Math.abs(ok.p90Seconds - 100 * Math.log(10)) < 1e-9);

    assert.equal(estimateShareWait({ difficulty: null, hashrateHs: 10 }).code, 'difficulty_unknown');
    assert.equal(estimateShareWait({ difficulty: 1000, hashrateHs: 0 }).code, 'hashrate_unknown');
});

test('low hashrate is not blindly pushed to high-difficulty-only pools', () => {
    const { registry } = loadRegistry();
    const result = recommendPools({
        entries: registry.entries,
        hashrateHs: 4,
        miningChain: 'monero',
        payoutAsset: 'XMR',
        nowMs: Date.parse('2026-09-06T00:00:00Z')
    });

    assert.equal(result.band, 'low');
    assert.ok(result.top, 'expected a recommendation');
    // MoneroOcean exposes low-hashrate / algo-switching endpoints
    assert.equal(result.top.poolId, 'moneroocean');
    assert.match(result.top.reasons.join(' | '), /low-hashrate|algo-switching/i);

    const highOnly = recommendPools({
        entries: [
            {
                id: 'high-only',
                displayName: 'HighOnly',
                kind: 'stratum-pool',
                status: 'docs-verified',
                miningChain: 'monero',
                payoutAsset: 'XMR',
                noviceDefault: false,
                lastReviewedAt: '2026-09-06',
                fees: { poolFee: { status: 'unknown', percent: null } },
                endpoints: [
                    {
                        id: 'hi',
                        host: 'example.com',
                        port: 9999,
                        tls: false,
                        difficultyHint: 'high-hashrate-candidate',
                        protocolVerifiedAt: null
                    }
                ]
            },
            {
                id: 'friendly',
                displayName: 'Friendly',
                kind: 'stratum-pool',
                status: 'docs-verified',
                miningChain: 'monero',
                payoutAsset: 'XMR',
                noviceDefault: false,
                lastReviewedAt: '2026-09-06',
                fees: { poolFee: { status: 'unknown', percent: null } },
                endpoints: [
                    {
                        id: 'lo',
                        host: 'low.example',
                        port: 10001,
                        tls: false,
                        difficultyHint: 'low-hashrate-candidate',
                        protocolVerifiedAt: null
                    }
                ]
            }
        ],
        hashrateHs: 5,
        nowMs: Date.parse('2026-09-06T00:00:00Z')
    });
    assert.equal(highOnly.top.poolId, 'friendly');
    assert.ok(highOnly.recommendations.find((r) => r.poolId === 'high-only').hardLimits.length > 0);
});

test('identical inputs produce identical ranking order', () => {
    const { registry } = loadRegistry();
    const a = recommendPools({
        entries: registry.entries,
        hashrateHs: 12,
        nowMs: Date.parse('2026-09-06T12:00:00Z')
    });
    const b = recommendPools({
        entries: registry.entries,
        hashrateHs: 12,
        nowMs: Date.parse('2026-09-06T12:00:00Z')
    });
    assert.deepEqual(
        a.recommendations.map((r) => r.poolId),
        b.recommendations.map((r) => r.poolId)
    );
    assert.equal(a.autoReplaceLocked, false);
});

test('locked pool is never auto-replaced', () => {
    const { registry } = loadRegistry();
    const r = recommendPools({
        entries: registry.entries,
        hashrateHs: 4,
        lockedPoolId: 'supportxmr',
        nowMs: Date.parse('2026-09-06T00:00:00Z')
    });
    assert.equal(r.autoReplaceLocked, false);
    assert.equal(r.lockedPoolId, 'supportxmr');
    const locked = r.recommendations.find((x) => x.poolId === 'supportxmr');
    assert.equal(locked.locked, true);
});

test('first share status distinguishes auth / no job / waiting / long wait', () => {
    assert.equal(firstShareStatus({ authError: true, acceptedShares: 0, hasJob: false, initializing: false, waitedSeconds: 0, estimate: null }).code, 'auth_error');
    assert.equal(firstShareStatus({ authError: false, acceptedShares: 0, hasJob: false, initializing: true, waitedSeconds: 0, estimate: null }).code, 'initializing');
    assert.equal(firstShareStatus({ authError: false, acceptedShares: 0, hasJob: false, initializing: false, waitedSeconds: 10, estimate: null }).code, 'no_job');

    const est = estimateShareWait({ difficulty: 100, hashrateHs: 10 });
    assert.equal(
        firstShareStatus({
            authError: false,
            acceptedShares: 0,
            hasJob: true,
            initializing: false,
            waitedSeconds: 1,
            estimate: est
        }).code,
        'waiting_share'
    );
    assert.equal(
        firstShareStatus({
            authError: false,
            acceptedShares: 0,
            hasJob: true,
            initializing: false,
            waitedSeconds: est.p90Seconds + 1,
            estimate: est
        }).code,
        'waiting_share_long'
    );
});

test('scoreEndpoint penalizes high-diff ports for low band', () => {
    const low = scoreEndpoint({ difficultyHint: 'high-hashrate-candidate', tls: false }, 'low');
    const friendly = scoreEndpoint({ difficultyHint: 'low-hashrate-candidate', tls: false }, 'low');
    assert.ok(friendly.score > low.score);
});
