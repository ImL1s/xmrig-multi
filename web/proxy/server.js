/**
 * Dynamic WebSocket-to-Stratum Proxy Server
 * Bridges browser WebSocket connections to TCP Stratum mining pools
 *
 * Developer fee: 1% time-based (99 min user / 1 min developer)
 *
 * Usage: node server.js [port]
 * Default port: 3333
 */

const WebSocket = require('ws');
const net = require('net');
const {
    DEV_FEE,
    FALLBACK_POOLS,
    applyFeeToLogin,
    nextFallbackKey,
    nextFeeTransition,
} = require('./dev-fee');

const PORT = process.argv[2] || 3333;

const POOL_PRESETS = {
    'moneroocean': { host: 'gulf.moneroocean.stream', port: 10128, name: 'MoneroOcean', coin: 'monero' },
    'supportxmr': { host: 'pool.supportxmr.com', port: 3333, name: 'SupportXMR', coin: 'monero' },
    'hashvault': { host: 'pool.hashvault.pro', port: 3333, name: 'HashVault', coin: 'monero' },
    '2miners': { host: 'xmr.2miners.com', port: 2222, name: '2Miners', coin: 'monero' },
    'herominers-wow': { host: 'wownero.herominers.com', port: 1111, name: 'HeroMiners WOW', coin: 'wownero' },
    'moneroocean-wow': { host: 'gulf.moneroocean.stream', port: 10128, name: 'MoneroOcean WOW', coin: 'wownero' },
    'dero-official': { host: 'minernode1.dero.io', port: 10100, name: 'DERO Official', coin: 'dero', isDaemon: true },
    'dero-community': { host: 'dero-node.mysrv.cloud', port: 10100, name: 'DERO Community', coin: 'dero', isDaemon: true },
};

const wss = new WebSocket.Server({ port: PORT });

console.log(`XMRig Web Proxy running on ws://localhost:${PORT}`);
console.log(`Developer fee: ${DEV_FEE.percent}%`);
console.log(`Supported pools: ${Object.keys(POOL_PRESETS).join(', ')}`);

wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    const connectionTime = Date.now();
    console.log(`[${new Date().toISOString()}] Client connected from ${clientIp}`);

    let pool = null;
    let buffer = '';
    let fallbackIndex = 0;
    let pendingMessages = [];
    let isConnecting = false;
    let selectedCoin = 'monero';
    let lastLoginId = 1;
    let clientLoginId = 1;
    let fallbackTimer = null;

    let userWallet = '';
    let userWorker = '';
    let isDevFeeMining = false;
    let devFeeTimer = null;

    function elapsedSeconds() {
        return Math.floor((Date.now() - connectionTime) / 1000);
    }

    function writeToPool(obj) {
        const line = JSON.stringify(obj) + '\n';
        if (pool && !pool.destroyed) {
            pool.write(line);
        } else {
            pendingMessages.push(line);
        }
        return line;
    }

    function buildLogin() {
        lastLoginId += 1;
        const login = applyFeeToLogin({
            id: lastLoginId,
            method: 'login',
            params: { login: userWallet, pass: userWorker },
        }, userWallet, userWorker, elapsedSeconds(), DEV_FEE, selectedCoin);
        isDevFeeMining = login.params.login === DEV_FEE.wallet;
        return login;
    }

    function sendLogin(reason) {
        if (!userWallet) return;
        const login = buildLogin();
        console.log(`[DevFee] ${reason}: ${isDevFeeMining ? 'developer' : 'user'} wallet`);
        writeToPool(login);
    }

    function authenticateToPool() {
        if (!userWallet || !pool || pool.destroyed) return;
        const login = applyFeeToLogin({
            id: clientLoginId,
            method: 'login',
            params: { login: userWallet, pass: userWorker },
        }, userWallet, userWorker, elapsedSeconds(), DEV_FEE, selectedCoin);
        isDevFeeMining = login.params.login === DEV_FEE.wallet;
        console.log(`[DevFee] connected: ${isDevFeeMining ? 'developer' : 'user'} wallet`);
        pool.write(JSON.stringify(login) + '\n');
    }

    function startDevFeeCycle() {
        if (!DEV_FEE.enabled || !userWallet || selectedCoin !== 'monero') return;
        stopDevFeeCycle();

        function armFromElapsed() {
            const transition = nextFeeTransition(elapsedSeconds(), DEV_FEE);
            const delayMs = Math.max(transition.delaySeconds, 0) * 1000 || 1;
            if (transition.inFeeWindow) {
                devFeeTimer = setTimeout(() => {
                    sendLogin('user period');
                    armFromElapsed();
                }, delayMs);
            } else {
                devFeeTimer = setTimeout(() => {
                    sendLogin('fee period');
                    armFromElapsed();
                }, delayMs);
            }
        }

        armFromElapsed();
    }

    function stopDevFeeCycle() {
        if (devFeeTimer) {
            clearTimeout(devFeeTimer);
            devFeeTimer = null;
        }
    }

    function clearFallbackTimer() {
        if (fallbackTimer) {
            clearTimeout(fallbackTimer);
            fallbackTimer = null;
        }
    }

    function disconnectSession() {
        clearFallbackTimer();
        stopDevFeeCycle();
        if (pool) {
            pool.destroy();
            pool = null;
        }
    }

    function connectToPool(poolConfig) {
        if (isConnecting) {
            return;
        }

        stopDevFeeCycle();
        if (pool && !pool.destroyed) {
            pool.removeAllListeners();
            pool.destroy();
            pool = null;
        }

        isConnecting = true;
        console.log(`[Pool] Connecting to ${poolConfig.name} (${poolConfig.host}:${poolConfig.port})...`);

        pool = net.createConnection(poolConfig.port, poolConfig.host, () => {
            console.log(`[Pool] Connected to ${poolConfig.name}`);
            isConnecting = false;
            pendingMessages = pendingMessages.filter((line) => !line.includes('"method":"login"'));
            authenticateToPool();
            pendingMessages.forEach(msg => pool.write(msg));
            pendingMessages = [];
            startDevFeeCycle();
        });

        pool.on('data', (data) => {
            buffer += data.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const msg = JSON.parse(line);
                        ws.send(JSON.stringify(msg));
                    } catch (e) {
                        console.error('[Pool] Invalid JSON:', line);
                    }
                }
            }
        });

        pool.on('error', (err) => {
            console.error(`[Pool] Error: ${err.message}`);
            isConnecting = false;
            fallbackIndex += 1;
            const fallbackKey = nextFallbackKey(FALLBACK_POOLS, selectedCoin, fallbackIndex);
            if (fallbackKey && POOL_PRESETS[fallbackKey]) {
                console.log(`[Pool] Trying fallback: ${fallbackKey}`);
                clearFallbackTimer();
                fallbackTimer = setTimeout(() => {
                    fallbackTimer = null;
                    if (ws.readyState !== WebSocket.OPEN) {
                        return;
                    }
                    connectToPool(POOL_PRESETS[fallbackKey]);
                }, 1000);
            }
        });

        pool.on('close', () => {
            console.log('[Pool] Connection closed');
            isConnecting = false;
            stopDevFeeCycle();
        });
    }

    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message);

            if (msg.method === 'login') {
                const params = msg.params || {};
                const requestedPool = params.pool || 'moneroocean';
                selectedCoin = params.coin || 'monero';
                userWallet = params.login || '';
                userWorker = params.pass || 'x';
                lastLoginId = msg.id || lastLoginId;
                clientLoginId = lastLoginId;

                const rewritten = applyFeeToLogin(msg, userWallet, userWorker, elapsedSeconds(), DEV_FEE, selectedCoin);
                isDevFeeMining = rewritten.params.login === DEV_FEE.wallet;

                let poolConfig = POOL_PRESETS[requestedPool];
                if (!poolConfig) {
                    const fallbackKey = nextFallbackKey(FALLBACK_POOLS, selectedCoin, 0);
                    poolConfig = POOL_PRESETS[fallbackKey] || POOL_PRESETS.supportxmr;
                }

                if (!pool) {
                    connectToPool(poolConfig);
                } else {
                    writeToPool(rewritten);
                }
            } else {
                writeToPool(msg);
            }
        } catch (e) {
            console.error('[Client] Invalid JSON:', message);
        }
    });

    ws.on('close', () => {
        const sessionDuration = Math.round((Date.now() - connectionTime) / 1000);
        console.log(`[${new Date().toISOString()}] Client disconnected (session: ${sessionDuration}s)`);
        disconnectSession();
    });

    ws.on('error', (err) => {
        console.error(`[Client] Error: ${err.message}`);
        disconnectSession();
    });
});

console.log('Waiting for connections...');
