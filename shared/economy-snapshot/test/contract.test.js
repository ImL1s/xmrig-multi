/**
 * Economy snapshot contract tests (#72).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEconomySnapshot,
  dedupeWalletBalances,
  AccrualLedger,
  csvSafe,
  formatSessionSummary
} from '../js/economy.js';

test('paid is not added on top of credited for valuation', () => {
  const s = buildEconomySnapshot({
    expectedGross: 10,
    credited: 8,
    paid: 3,
    marketRate: 100,
    energyCostFiat: 50
  });
  assert.equal(s.valueLayer, 'credited');
  assert.equal(s.netNative, 8);
  assert.equal(s.unpaid, 5);
  assert.equal(s.fiatGross, 800);
  assert.equal(s.netFiat, 750);
});

test('unknown revenue with known cost does not invent profitable 0', () => {
  const s = buildEconomySnapshot({
    energyCostFiat: 12,
    marketRate: 100
  });
  assert.equal(s.netFiat, null);
  assert.equal(s.netQuality, 'unknown');
  assert.equal(s.profitable, null);
});

test('expired market rate blocks fiat conversion', () => {
  const s = buildEconomySnapshot({
    credited: 1,
    marketRate: 100,
    marketRateExpired: true,
    energyCostFiat: 1
  });
  assert.equal(s.fiatGross, null);
  assert.equal(s.netQuality, 'unknown');
});

test('pool fee already deducted is not subtracted again', () => {
  const a = buildEconomySnapshot({
    credited: 10,
    developerFeeNative: 1,
    poolFeeAlreadyDeducted: true,
    marketRate: 1,
    energyCostFiat: 0
  });
  assert.equal(a.netNative, 10);
  const b = buildEconomySnapshot({
    credited: 10,
    developerFeeNative: 1,
    poolFeeAlreadyDeducted: false,
    marketRate: 1,
    energyCostFiat: 0
  });
  assert.equal(b.netNative, 9);
});

test('shared wallet balances are not summed twice', () => {
  const d = dedupeWalletBalances([
    { walletId: 'w1', poolId: 'p1', balance: 5 },
    { walletId: 'w1', poolId: 'p1', balance: 5 },
    { walletId: 'w2', poolId: 'p1', balance: 3 }
  ]);
  assert.equal(d.total, 8);
  assert.equal(d.wallets, 2);
});

test('same wallet across different pools sums once per pool', () => {
  const d = dedupeWalletBalances([
    { walletId: 'w1', poolId: 'a', balance: 5 },
    { walletId: 'w1', poolId: 'b', balance: 3 }
  ]);
  assert.equal(d.total, 8);
});

test('accrual ledger dedupes record ids', () => {
  const L = new AccrualLedger();
  assert.equal(L.commit({ id: 'c1', kind: 'credited', amountNative: 2 }).accepted, true);
  assert.equal(L.commit({ id: 'c1', kind: 'credited', amountNative: 2 }).accepted, false);
  assert.equal(L.totals().credited, 2);
});

test('csvSafe guards formula injection', () => {
  assert.equal(csvSafe('=cmd'), "'=cmd");
  assert.equal(csvSafe('ok'), 'ok');
});

test('session summary marks incomplete net', () => {
  const snap = buildEconomySnapshot({ energyCostFiat: 1 });
  const text = formatSessionSummary(snap, { elapsedLabel: '2h', pauseReasons: ['thermal'] });
  assert.match(text, /Net: unknown/);
  assert.match(text, /thermal/);
});

test('zero hashrate expected stays null not fake daily', () => {
  const s = buildEconomySnapshot({ expectedGross: null, credited: null });
  assert.equal(s.expectedGross, null);
  assert.equal(s.profitable, null);
});
