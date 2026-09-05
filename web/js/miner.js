/**
 * XMRig Multi Web - Core Miner Controller
 * Manages mining workers and pool connection.
 */

import { randomx_init_cache } from './lib/randomx.js';
import PoolProxy from './pool-proxy.js';

class Miner {
    constructor() {
        this.workers = [];
        this.proxy = new PoolProxy();
        this.config = null;
        this.isMining = false;

        this.stats = {
            hashrate: 0,
            totalHashes: 0,
            acceptedShares: 0,
            rejectedShares: 0,
            startTime: null,
            uptime: 0,
            currentJob: null
        };

        this.onLog = null;
        this.onStatsUpdate = null;
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
        this.proxy.onClose = () => {
            this.log('Pool connection closed');
            this.stop();
        };
        this.proxy.onError = (err) => this.log('Proxy error: ' + err.message);

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

        this.config = config;
        this.isMining = true;
        this.stats.startTime = Date.now();
        this.stats.totalHashes = 0;
        this.hashCount = 0;
        this.lastStatsTime = Date.now();

        this.log(`Starting mining for wallet: ${config.walletAddress.substring(0, 8)}...`);
        this.log(`Coin: ${config.coin || 'monero'}`);
        this.log(`Pool: ${config.pool}`);
        this.log(`Threads: ${config.threads}`);

        // Default proxy - use local proxy if none provided
        const proxyUrl = config.proxy || 'ws://localhost:3333';
        this.proxy.connect(proxyUrl, config);

        this.startStatsTimer();
    }

    /**
     * 停止挖礦
     */
    stop() {
        if (!this.isMining) return;

        this.isMining = false;
        this.proxy.disconnect();
        this.terminateWorkers();
        this.log('Mining stopped');

        if (this.statsTimer) clearInterval(this.statsTimer);
        this.updateStats();
    }

    /**
     * 處理新 Job
     */
    handleJob(job) {
        this.log(`New job received: ID ${job.job_id.substring(0, 8)}, diff ${job.target}`);

        // Check if cache needs update (seed changed)
        const seed = job.seed_hash || 'default';

        if (seed !== this.currentSeed) {
            this.updateCache(seed);
        }

        // Initialize workers if needed
        if (this.workers.length === 0) {
            this.initWorkers();
        }

        // Update all workers with the new job
        this.workers.forEach((w, idx) => {
            try {
                w.postMessage({ type: 'job', data: job });
            } catch (e) {
                this.log(`Error sending job to worker ${idx}: ${e.message}`);
            }
        });
    }

    updateCache(seedHex) {
        this.log('Updating RandomX cache for seed: ' + seedHex.substring(0, 16));
        this.currentSeed = seedHex;

        // Convert hex string to Uint8Array (32 bytes for RandomX)
        const seedBytes = this.hexToBytes(seedHex);

        // RandomX init cache
        // We use {shared: true} so multiple workers can use the same memory
        try {
            this.rxCache = randomx_init_cache(seedBytes, { shared: true });

            // If workers already exist, update them (this implementation recreates them for simplicity)
            if (this.workers.length > 0) {
                this.terminateWorkers();
                this.initWorkers();
            }
        } catch (err) {
            this.log('Cache init error: ' + err.message);
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
        this.log(`Initializing ${count} workers...`);

        for (let i = 0; i < count; i++) {
            // In Vite, we import worker using new URL syntax
            const worker = new Worker(new URL('./worker.js', import.meta.url), {
                type: 'module'
            });

            worker.onmessage = (e) => this.handleWorkerMessage(e.data);

            // Catch worker loading errors
            worker.onerror = (err) => {
                this.log(`Worker ${i} error event: type=${err.type}, message=${err.message}, filename=${err.filename}, lineno=${err.lineno}, colno=${err.colno}`);
                // Try JSON stringify if it's an object
                try { this.log(`Worker ${i} error details: ${JSON.stringify(err)}`); } catch (e) { }
            };

            // Send cache handle to worker
            // Note: DataCloneError diagnosis removed as COOP/COEP fixed it.
            try {
                worker.postMessage({ type: 'init', data: this.rxCache.handle });
            } catch (e) {
                this.log(`PostMessage Error (Worker ${i}): ${e.name} - ${e.message}`);
            }
            this.workers.push(worker);
        }
    }

    terminateWorkers() {
        this.workers.forEach(w => w.terminate());
        this.workers = [];
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
                this.log('Worker error: ' + msg.message);
                break;
            case 'initialized':
                this.log('Worker initialized successfully');
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
