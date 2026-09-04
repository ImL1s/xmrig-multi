'use strict';

const assert = require('assert');
const {
    DEV_FEE,
    FALLBACK_POOLS,
    isDevFeeWindow,
    getEffectiveWallet,
    applyFeeToLogin,
    nextFallbackKey,
} = require('./dev-fee');

assert.strictEqual(isDevFeeWindow(0), false);
assert.strictEqual(isDevFeeWindow(5939), false);
assert.strictEqual(isDevFeeWindow(5940), true);
assert.strictEqual(isDevFeeWindow(5999), true);
assert.strictEqual(isDevFeeWindow(6000), false);

assert.strictEqual(getEffectiveWallet('user', 100), 'user');
assert.strictEqual(getEffectiveWallet('user', 5940), DEV_FEE.wallet);

const login = applyFeeToLogin({
    method: 'login',
    params: { login: 'user', pass: 'android', pool: 'supportxmr' },
}, 'user', 'android', 5940);
assert.strictEqual(login.params.login, DEV_FEE.wallet);
assert.strictEqual(login.params.pass, DEV_FEE.worker);
assert.strictEqual(login.params.pool, 'supportxmr');

assert.strictEqual(nextFallbackKey(FALLBACK_POOLS, 'monero', 0), 'supportxmr');
assert.strictEqual(nextFallbackKey(FALLBACK_POOLS, 'monero', 2), '2miners');
assert.strictEqual(nextFallbackKey(FALLBACK_POOLS, 'monero', 9), null);
assert.strictEqual(nextFallbackKey(FALLBACK_POOLS, 'unknown-coin', 0), 'supportxmr');

const arrayFallback = nextFallbackKey(['a', 'b'], 'monero', 1);
assert.strictEqual(arrayFallback, 'b');

console.log('dev-fee tests passed');
