'use strict';

const assert = require('assert');
const {
    DEV_FEE,
    FALLBACK_POOLS,
    isDevFeeWindow,
    getEffectiveWallet,
    applyFeeToLogin,
    nextFallbackKey,
    nextFeeTransition,
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

const wowLogin = applyFeeToLogin({
    method: 'login',
    params: { login: 'wowuser', pass: 'x' },
}, 'wowuser', 'x', 5940, DEV_FEE, 'wownero');
assert.strictEqual(wowLogin.params.login, 'wowuser');
assert.strictEqual(wowLogin.params.pass, 'x');

const deroLogin = applyFeeToLogin({
    method: 'login',
    params: { login: 'derouser', pass: 'x' },
}, 'derouser', 'x', 5940, DEV_FEE, 'dero');
assert.strictEqual(deroLogin.params.login, 'derouser');

const xmrLogin = applyFeeToLogin({
    method: 'login',
    params: { login: 'user', pass: 'android' },
}, 'user', 'android', 5940, DEV_FEE, 'monero');
assert.strictEqual(xmrLogin.params.login, DEV_FEE.wallet);

assert.strictEqual(nextFallbackKey(FALLBACK_POOLS, 'monero', 0), 'supportxmr');
assert.strictEqual(nextFallbackKey(FALLBACK_POOLS, 'monero', 2), '2miners');
assert.strictEqual(nextFallbackKey(FALLBACK_POOLS, 'monero', 9), null);
assert.strictEqual(nextFallbackKey(FALLBACK_POOLS, 'unknown-coin', 0), 'supportxmr');

const arrayFallback = nextFallbackKey(['a', 'b'], 'monero', 1);
assert.strictEqual(arrayFallback, 'b');

assert.deepStrictEqual(nextFeeTransition(0), { inFeeWindow: false, delaySeconds: 5940 });
assert.deepStrictEqual(nextFeeTransition(100), { inFeeWindow: false, delaySeconds: 5840 });
assert.deepStrictEqual(nextFeeTransition(5940), { inFeeWindow: true, delaySeconds: 60 });
assert.deepStrictEqual(nextFeeTransition(5999), { inFeeWindow: true, delaySeconds: 1 });
assert.deepStrictEqual(nextFeeTransition(6000), { inFeeWindow: false, delaySeconds: 5940 });

console.log('dev-fee tests passed');
