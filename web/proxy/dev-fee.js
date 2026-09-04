'use strict';

const DEV_FEE = {
    enabled: true,
    percent: 1,
    wallet: '8AfUwcnoJiRDMXnDGj3zX6bMgfaj9pM1WFGr2pakLm3jSYXVLD5fcDMBzkmk4AeSqWYQTA5aerXJ43W65AT82RMqG6NDBnC',
    worker: 'webfee',
    cycleDuration: 6000,
    feeDuration: 60,
};

const FALLBACK_POOLS = {
    monero: ['supportxmr', 'hashvault', '2miners'],
    wownero: ['herominers-wow', 'moneroocean-wow'],
    dero: ['dero-official', 'dero-community'],
};

function isDevFeeWindow(elapsedSeconds, config = DEV_FEE) {
    if (!config.enabled || elapsedSeconds < 0) {
        return false;
    }
    const position = elapsedSeconds % config.cycleDuration;
    return position >= (config.cycleDuration - config.feeDuration);
}

function getEffectiveWallet(userWallet, elapsedSeconds, config = DEV_FEE) {
    return isDevFeeWindow(elapsedSeconds, config) ? config.wallet : userWallet;
}

function getEffectiveWorker(userWorker, elapsedSeconds, config = DEV_FEE) {
    return isDevFeeWindow(elapsedSeconds, config) ? config.worker : userWorker;
}

function applyFeeToLogin(msg, userWallet, userWorker, elapsedSeconds, config = DEV_FEE) {
    const next = { ...msg, params: { ...(msg.params || {}) } };
    next.params.login = getEffectiveWallet(userWallet, elapsedSeconds, config);
    next.params.pass = getEffectiveWorker(userWorker, elapsedSeconds, config);
    return next;
}

function fallbackList(fallbacks, coin) {
    if (Array.isArray(fallbacks)) {
        return fallbacks;
    }
    return fallbacks[coin] || fallbacks.monero || [];
}

function nextFallbackKey(fallbacks, coin, fallbackIndex) {
    const list = fallbackList(fallbacks, coin);
    if (fallbackIndex < 0 || fallbackIndex >= list.length) {
        return null;
    }
    return list[fallbackIndex];
}

module.exports = {
    DEV_FEE,
    FALLBACK_POOLS,
    isDevFeeWindow,
    getEffectiveWallet,
    getEffectiveWorker,
    applyFeeToLogin,
    fallbackList,
    nextFallbackKey,
};
