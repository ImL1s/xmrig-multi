/**
 * XMRig Multi Web - Core Miner Controller
 * Manages mining workers and pool connection.
 */

import { randomx_init_cache } from './lib/randomx.js';
import PoolProxy from './pool-proxy.js';
import { runMiningPreflight, validateSeedHash } from './runtime-preflight.js';

class Miner {
    constructor() {
        this.workers = [];
        this.proxy = new PoolProxy();
        this.config = null;
        this.isMining = false;
        this.readyWorkers = 0;
        this.generation = 0;

        this.stats = {
            hashrate: 0,
            totalHashes: 0,
            acceptedShares: 0,
            rejectedShares: 0,
            startTime: null,
            uptime: 0,
            currentJob: null,
            isMining: false,
            preflight: null,
            workersReady: 0,
            workersTotal: 0
        };

        this.onLog = null;
        this.onStatsUpdate = null;
        this.onProxyFailure = null;
        this.onRuntimeFailure = null;
        this.hashCount = 0;
        this.lastStatsTime = null;

        // RandomX Cache (shared among workers)
        this.rxCache = null;
        this.currentSeed = null;

        // Initialize proxy callbacks
        this.setupProxyHandlers();
    }

    setupProxyHandlers() {
        this.proxy.onOpen = () => this.log('Connected to pool proxy');
        this.proxy.onClose = (detail = {}) => {
            this.log('Pool connection closed');
            if (this.onProxyFailure && detail.code) {
                this.onProxyFailure({ code: detail.code, message: detail.reason });
            }
            this.stop();
        };
        this.proxy.onError = (err) => {
            this.log('Proxy error: ' + err.message);
            if (this.onProxyFailure) {
                this.onProxyFailure({ message: err.message });
            }
        };

        this.proxy.onJob = (job) => {
            this.stats.currentJob = job;
            this.handleJob(job);
        };

        this.proxy.onAccepted = () => {
            this.stats.acceptedShares++;
            this.log('Share accepted!');
            this.updateStats();
        };

        this.proxy.onRejected = (reason) => {
            this.stats.rejectedShares++;
            this.log('Share rejected: ' + reason);
            this.updateStats();
        };
    }

    /**
     * 啟動挖礦
     */
    start(config) {
        if (this.isMining) return;

        const preflight = runMiningPreflight();
        this.stats.preflight = preflight;
        if (!preflight.ok) {
            this.log(`Preflight failed [${preflight.code}]: ${preflight.message}`);
            for (const hint of preflight.actionHints) this.log(`Hint: ${hint}`);
            this.stats.isMining = false;
            this.updateStats();
            if (this.onRuntimeFailure) {
                this.onRuntimeFailure(preflight);
            }
            return;
        }
        this.log('Preflight OK (secure + COI + SAB + WASM + Worker)');

        this.config = config;
        this.isMining = true;
        this.generation += 1;
        this.readyWorkers = 0;
        this.stats.workersReady = 0;
        this.stats.workersTotal = config.threads || 1;
        this.stats.startTime = Date.now();
        this.stats.totalHashes = 0;
        this.hashCount = 0;
        this.lastStatsTime = Date.now();

        this.log(`Starting mining for wallet: ${config.walletAddress.substring(0, 8)}...`);
        this.log(`Coin: ${config.coin || 'monero'}`);
        this.log(`Pool: ${config.pool}`);
        this.log(`Threads: ${config.threads}`);

        const proxyUrl = config.proxy;
        if (!proxyUrl || (!proxyUrl.startsWith('ws://') && !proxyUrl.startsWith('wss://'))) {
            this.log('Proxy URL required — refusing implicit localhost default (#50)');
            this.failRuntime({
                code: 'missing_proxy',
                message: 'Proxy URL required'
            });
            return;
        }
        this.proxy.connect(proxyUrl, config);

        this.startStatsTimer();
    }

    failRuntime(detail) {
        this.log(`Runtime failure [${detail.code || 'unknown'}]: ${detail.message}`);
        if (this.onRuntimeFailure) this.onRuntimeFailure(detail);
        this.stop();
    }

    /**
     * 停止挖礦
     */
    stop() {
        if (!this.isMining) {
            this.stats.isMining = false;
            this.updateStats();
            return;
        }

        this.isMining = false;
        this.stats.isMining = false;
        this.proxy.disconnect();
        this.terminateWorkers();
        this.log('Mining stopped');

        if (this.statsTimer) clearInterval(this.statsTimer);
        this.statsTimer = null;
        this.updateStats();
    }

    /**
     * 處理新 Job
     */
    handleJob(job) {
        if (!this.isMining) return;
        this.log(`New job received: ID ${job.job_id.substring(0, 8)}, diff ${job.target}`);

        const seedCheck = validateSeedHash(job.seed_hash);
        if (!seedCheck.ok) {
            this.failRuntime(seedCheck);
            return;
        }
        const seed = seedCheck.seed;

        if (seed !== this.currentSeed) {
            this.updateCache(seed);
        }

        if (!this.rxCache) {
            this.failRuntime({ code: 'cache_missing', message: 'RandomX cache not ready' });
            return;
        }

        if (this.workers.length === 0) {
            this.initWorkers();
        }

        // Only dispatch jobs after at least one worker reports initialized.
        if (this.readyWorkers < 1) {
            this.log(`Waiting for worker readiness (${this.readyWorkers}/${this.stats.workersTotal}) before hashing`);
            this._pendingJob = job;
            return;
        }

        this.dispatchJob(job);
    }

    dispatchJob(job) {
        this.workers.forEach((w, idx) => {
            try {
                w.postMessage({ type: 'job', data: job });
            } catch (e) {
                this.log(`Error sending job to worker ${idx}: ${e.message}`);
                this.failRuntime({ code: 'worker_post_failed', message: e.message });
            }
        });
    }

    updateCache(seedHex) {
        this.log('Updating RandomX cache for seed: ' + seedHex.substring(0, 16));
        this.currentSeed = seedHex;

        const seedBytes = this.hexToBytes(seedHex);

        try {
            this.rxCache = randomx_init_cache(seedBytes, { shared: true });
            this.readyWorkers = 0;
            this.stats.workersReady = 0;

            if (this.workers.length > 0) {
                this.terminateWorkers();
                this.initWorkers();
            }
        } catch (err) {
            this.failRuntime({
                code: 'cache_init_failed',
                message: err.message || String(err),
                actionHints: ['Lower threads', 'Retry after freeing memory', 'Confirm COOP/COEP headers']
            });
        }
    }

    /**
     * Convert hex string to Uint8Array
     */
    hexToBytes(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        }
        return bytes;
    }

    initWorkers() {
        if (!this.rxCache) return;

        const count = this.config.threads || 1;
        this.stats.workersTotal = count;
        this.readyWorkers = 0;
        this.stats.workersReady = 0;
        this.log(`Initializing ${count} workers...`);

        const gen = this.generation;
        for (let i = 0; i < count; i++) {
            const worker = new Worker(new URL('./worker.js', import.meta.url), {
                type: 'module'
            });

            worker.onmessage = (e) => {
                if (gen !== this.generation) return;
                this.handleWorkerMessage(e.data);
            };

            worker.onerror = (err) => {
                this.log(`Worker ${i} error event: ${err.message || err.type}`);
                this.failRuntime({
                    code: 'worker_error',
                    message: err.message || `Worker ${i} failed to load`,
                    actionHints: ['Retry', 'Lower threads', 'Check module worker support']
                });
            };

            try {
                worker.postMessage({ type: 'init', data: this.rxCache.handle });
            } catch (e) {
                this.log(`PostMessage Error (Worker ${i}): ${e.name} - ${e.message}`);
                this.failRuntime({
                    code: 'worker_post_failed',
                    message: `${e.name}: ${e.message}`,
                    actionHints: ['Confirm crossOriginIsolated', 'Confirm COOP/COEP']
                });
                return;
            }
            this.workers.push(worker);
        }
        this.updateStats();
    }

    terminateWorkers() {
        this.workers.forEach(w => w.terminate());
        this.workers = [];
        this.readyWorkers = 0;
        this.stats.workersReady = 0;
        this._pendingJob = null;
    }

    handleWorkerMessage(msg) {
        switch (msg.type) {
            case 'hashrate':
                this.hashCount += msg.count;
                this.stats.totalHashes += msg.count;
                break;
            case 'result':
                this.log(`Found Share! Nonce: ${msg.nonce}`);
                this.proxy.submit(msg.job_id, msg.nonce, msg.result);
                break;
            case 'error':
                this.failRuntime({
                    code: 'worker_compute_error',
                    message: msg.message || 'worker error',
                    actionHints: ['Retry', 'Lower threads']
                });
                break;
            case 'initialized':
                this.readyWorkers += 1;
                this.stats.workersReady = this.readyWorkers;
                this.log(`Worker initialized (${this.readyWorkers}/${this.stats.workersTotal})`);
                this.updateStats();
                if (this._pendingJob && this.readyWorkers >= 1) {
                    const job = this._pendingJob;
                    this._pendingJob = null;
                    this.dispatchJob(job);
                }
                break;
        }
    }

    startStatsTimer() {
        this.statsTimer = setInterval(() => {
            const now = Date.now();
            const elapsed = (now - this.lastStatsTime) / 1000;

            if (elapsed > 0) {
                this.stats.hashrate = this.hashCount / elapsed;
                this.hashCount = 0;
                this.lastStatsTime = now;
                this.stats.uptime = Math.floor((now - this.stats.startTime) / 1000);
            }

            this.stats.isMining = this.isMining;
            this.updateStats();
        }, 2000);
    }

    updateStats() {
        if (this.onStatsUpdate) {
            this.onStatsUpdate(this.stats);
        }
    }

    log(message) {
        if (this.onLog) {
            this.onLog(`[Miner] ${message}`);
        }
    }
}

export default Miner;
