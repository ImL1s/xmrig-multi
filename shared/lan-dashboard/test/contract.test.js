/**
 * LAN dashboard contract tests (#80).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPairingChallenge,
  completePairing,
  revokeClient,
  isClientAuthorized
} from '../js/pairing.js';
import { authorizeBoardCommand, presentStopDelivery } from '../js/auth.js';
import { aggregateBoard } from '../js/aggregate.js';
import { presentDeviceCard } from '../js/board.js';
import { buildCommand } from '../../companion-sync/js/protocol.js';

const T0 = Date.parse('2026-09-06T12:00:00Z');

test('pairing rejects expired, replay, wrong host, unbound channel', () => {
  const ch = createPairingChallenge({
    code: '123456',
    hostDeviceId: 'miner-a',
    nowMs: T0,
    ttlMs: 1000
  });
  assert.equal(
    completePairing(ch, { code: '123456', nowMs: T0 + 5000, channelBound: true }).ok,
    false
  );
  const ok = completePairing(ch, {
    code: '123456',
    nowMs: T0 + 10,
    channelBound: true,
    clientDeviceId: 'pad-1',
    expectedHostDeviceId: 'miner-a'
  });
  assert.equal(ok.ok, true);
  assert.equal(
    completePairing(ok.nextChallenge, {
      code: '123456',
      nowMs: T0 + 20,
      channelBound: true,
      clientDeviceId: 'pad-2'
    }).ok,
    false
  );
  assert.equal(
    completePairing(ch, {
      code: '123456',
      nowMs: T0 + 10,
      channelBound: false,
      clientDeviceId: 'pad-1'
    }).ok,
    false
  );
  assert.equal(
    completePairing(ch, {
      code: '123456',
      nowMs: T0 + 10,
      channelBound: true,
      expectedHostDeviceId: 'miner-b'
    }).reason.includes('Host'),
    true
  );
});

test('revoke and read-only cannot Start', () => {
  let reg = { clients: { c1: { role: 'readonly', revoked: false } } };
  const start = buildCommand({
    type: 'start',
    targetDeviceId: 'miner-a',
    issuedAtMs: T0
  });
  const denied = authorizeBoardCommand(reg, 'c1', start, { nowMs: T0 });
  assert.equal(denied.ack, 'rejected');
  reg = revokeClient(reg, 'c1');
  assert.equal(isClientAuthorized(reg, 'c1').ok, false);
});

test('stop undelivered is not pretended stopped', () => {
  const p = presentStopDelivery('undelivered');
  assert.equal(p.pretendStopped, false);
  assert.match(p.label, /Undelivered/);
});

test('shared meter counted once; wallet::pool credited once; algos grouped', () => {
  const agg = aggregateBoard([
    {
      deviceId: 'a',
      algorithm: 'rx/0',
      hashrateHs: 100,
      meterId: 'm1',
      powerW: 50,
      costFiat: 1,
      walletId: 'w',
      poolId: 'p',
      creditedFiat: 5
    },
    {
      deviceId: 'b',
      algorithm: 'rx/0',
      hashrateHs: 200,
      meterId: 'm1',
      powerW: 50,
      costFiat: 1,
      walletId: 'w',
      poolId: 'p',
      creditedFiat: 5
    },
    {
      deviceId: 'c',
      algorithm: 'ghostrider',
      hashrateHs: 10,
      powerW: 5,
      walletId: 'w2',
      poolId: 'p2',
      creditedFiat: 1
    }
  ]);
  assert.equal(agg.hashrateByAlgo['rx/0'], 300);
  assert.equal(agg.hashrateByAlgo.ghostrider, 10);
  assert.equal(agg.powerW, 55);
  assert.equal(agg.meterCount, 1);
  assert.equal(agg.creditedFiat, 6);
});

test('cards stay independent on stale/session change', () => {
  const stale = presentDeviceCard(
    {
      deviceId: 'a',
      status: 'mining',
      hashrateHs: 9,
      lastUpdatedAtMs: T0,
      reachable: true,
      paired: true
    },
    T0 + 120_000
  );
  assert.equal(stale.live, false);
  assert.match(stale.hashrateLabel || '', /not live/);

  const session = presentDeviceCard(
    {
      deviceId: 'b',
      status: 'mining',
      hashrateHs: 9,
      lastUpdatedAtMs: T0,
      sessionId: 'old',
      expectedSessionId: 'new',
      reachable: true,
      paired: true
    },
    T0
  );
  assert.equal(session.hashrateLabel, null);
  assert.match(session.note, /session/i);
});
