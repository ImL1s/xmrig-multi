// XMRig Multi Desktop - Frontend
import { invoke } from '@tauri-apps/api/core';

// DOM Elements
const elements = {
    cpuName: document.getElementById('cpu-name'),
    cpuThreads: document.getElementById('cpu-threads'),
    memory: document.getElementById('memory'),
    osInfo: document.getElementById('os-info'),
    statusIndicator: document.getElementById('status-indicator'),
    miningStatus: document.getElementById('mining-status'),
    hashrate: document.getElementById('hashrate'),
    shares: document.getElementById('shares'),
    difficulty: document.getElementById('difficulty'),
    uptime: document.getElementById('uptime'),
    coinType: document.getElementById('coin-type'),
    poolUrl: document.getElementById('pool-url'),
    wallet: document.getElementById('wallet'),
    walletError: document.getElementById('wallet-error'),
    worker: document.getElementById('worker'),
    threads: document.getElementById('threads'),
    threadValue: document.getElementById('thread-value'),
    startBtn: document.getElementById('start-btn'),
    stopBtn: document.getElementById('stop-btn'),
    logOutput: document.getElementById('log-output'),
};

// Shown instead of a fabricated 0.00 before the miner reports anything (#54).
const PLACEHOLDER = '\u2013';
const HASHRATE_PLACEHOLDER = '\u2013.\u2013\u2013';

// Pool configurations per coin
const poolConfigs = {
    monero: [
        { url: 'gulf.moneroocean.stream:10128', name: 'MoneroOcean (Recommended, XMR payout)', algo: 'rx/0', status: 'supported' },
        { url: 'pool.supportxmr.com:3333', name: 'SupportXMR', algo: 'rx/0', status: 'supported' },
        { url: 'pool.hashvault.pro:3333', name: 'HashVault', algo: 'rx/0', status: 'supported' },
        { url: 'xmr.2miners.com:2222', name: '2Miners', algo: 'rx/0', status: 'supported' },
    ],
    wownero: [
        {
            url: '',
            name: 'Wownero unavailable — need signer/daemon (#28)',
            algo: 'rx/wow',
            status: 'unavailable'
        },
    ],
    dero: [
        {
            url: '',
            name: 'DERO unavailable — need daemon adapter (#27)',
            algo: 'astrobwt/v3',
            status: 'unavailable'
        },
    ],
};

let statsInterval = null;
let isMining = false;

// Initialize app
async function init() {
    log('Initializing XMRig Multi Desktop...');
    await loadSystemInfo();
    setupEventListeners();
    updatePoolOptions();
    log('Ready to mine!');
}

// Load system information from Rust backend
async function loadSystemInfo() {
    try {
        const info = await invoke('get_system_info');
        elements.cpuName.textContent = info.cpu_name;
        elements.cpuThreads.textContent = `${info.cpu_cores} / ${info.cpu_threads}`;
        elements.memory.textContent = formatBytes(info.memory_total);
        elements.osInfo.textContent = `${info.os_name} ${info.os_version} (${info.arch})`;

        // Set max threads
        elements.threads.max = info.cpu_threads;
        elements.threads.value = Math.max(1, info.cpu_threads - 1);
        elements.threadValue.textContent = elements.threads.value;

        log(`System: ${info.cpu_name}, ${info.cpu_threads} threads`);
    } catch (error) {
        log(`Error loading system info: ${error}`, 'error');
    }
}

// Setup event listeners
function setupEventListeners() {
    elements.coinType.addEventListener('change', updatePoolOptions);
    elements.threads.addEventListener('input', () => {
        elements.threadValue.textContent = elements.threads.value;
    });
    elements.wallet.addEventListener('input', clearWalletError);
    elements.startBtn.addEventListener('click', startMining);
    elements.stopBtn.addEventListener('click', stopMining);
}

// Update pool options based on selected coin
function updatePoolOptions() {
    const coin = elements.coinType.value;
    const pools = poolConfigs[coin] || poolConfigs.monero;

    elements.poolUrl.innerHTML = pools.map(p =>
        `<option value="${p.url}" data-algo="${p.algo}" data-status="${p.status || 'supported'}">${p.name}</option>`
    ).join('');

    // Say up front that the coin cannot run, instead of accepting a click and then refusing it.
    const blocked = pools.every(p => p.status === 'unavailable');
    if (!isMining) {
        elements.startBtn.disabled = blocked;
    }
    elements.startBtn.title = blocked
        ? `${coin.toUpperCase()} is not supported by this build`
        : '';
}

function isCoinBlocked() {
    const pools = poolConfigs[elements.coinType.value] || poolConfigs.monero;
    return pools.every(p => p.status === 'unavailable');
}

// Start mining
async function startMining() {
    const wallet = elements.wallet.value.trim();
    if (!wallet) {
        showWalletError('Enter the address your payouts should go to.');
        return;
    }

    const coin = elements.coinType.value;
    if (coin === 'wownero') {
        log('Wownero start blocked until verified signer/daemon flow (#28)', 'error');
        return;
    }
    if (coin === 'dero') {
        log('DERO start blocked: needs dedicated daemon adapter (#27)', 'error');
        return;
    }

    const poolOption = elements.poolUrl.selectedOptions[0];
    if (poolOption?.dataset?.status === 'unavailable' || !elements.poolUrl.value) {
        log('Selected pool is unavailable', 'error');
        return;
    }
    const algo = poolOption.dataset.algo || 'rx/0';

    if (elements.poolUrl.value.toLowerCase().includes('moneroocean')) {
        const isXmr = (wallet.startsWith('4') || wallet.startsWith('8')) && wallet.length >= 95;
        if (!isXmr) {
            showWalletError('MoneroOcean pays out in XMR, so this must be a Monero address (#29).');
            return;
        }
    }

    clearWalletError();

    const config = {
        pool_url: elements.poolUrl.value,
        wallet_address: wallet,
        worker_name: elements.worker.value || 'desktop',
        threads: parseInt(elements.threads.value),
        coin_type: coin,
        algorithm: algo,
    };

    log(`Starting ${coin.toUpperCase()} mining...`);
    log(`Pool: ${config.pool_url}`);
    log(`Threads: ${config.threads}`);

    try {
        const result = await invoke('start_mining', { config });
        log(result, 'success');
        setMiningState(true);
        startStatsPolling();
    } catch (error) {
        log(`Failed to start mining: ${error}`, 'error');
    }
}

// Stop mining
async function stopMining() {
    log('Stopping mining...');
    try {
        const result = await invoke('stop_mining');
        log(result, 'success');
        setMiningState(false);
        stopStatsPolling();
    } catch (error) {
        log(`Failed to stop mining: ${error}`, 'error');
    }
}

// Set UI mining state
function setMiningState(mining) {
    isMining = mining;
    elements.startBtn.disabled = mining || isCoinBlocked();
    elements.stopBtn.disabled = !mining;
    elements.statusIndicator.className = `status-indicator ${mining ? 'mining' : ''}`;
    elements.miningStatus.textContent = mining ? 'Mining' : 'Stopped';

    // Disable config while mining
    elements.coinType.disabled = mining;
    elements.poolUrl.disabled = mining;
    elements.wallet.disabled = mining;
    elements.worker.disabled = mining;
    elements.threads.disabled = mining;
}

// Start polling for stats
function startStatsPolling() {
    statsInterval = setInterval(async () => {
        try {
            const stats = await invoke('get_mining_stats');
            updateStats(stats);
        } catch (error) {
            console.error('Stats error:', error);
        }
    }, 1000);
}

// Stop polling for stats
function stopStatsPolling() {
    if (statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
    }
    resetStats();
}

// Update stats display
function updateStats(stats) {
    // A running miner with no accepted share yet reports 0 H/s honestly; that is a real
    // measurement, not a placeholder, so it stays a number.
    setStat(elements.hashrate, stats.hashrate.toFixed(2), true);
    setStat(elements.shares, `${stats.shares_accepted} / ${stats.shares_rejected}`, true);
    setStat(elements.difficulty, formatNumber(stats.difficulty), stats.difficulty > 0);
    setStat(elements.uptime, formatUptime(stats.uptime), true);
}

// Reset stats display
function resetStats() {
    setStat(elements.hashrate, HASHRATE_PLACEHOLDER, false);
    setStat(elements.shares, PLACEHOLDER, false);
    setStat(elements.difficulty, PLACEHOLDER, false);
    setStat(elements.uptime, PLACEHOLDER, false);
}

function setStat(node, text, hasValue) {
    node.textContent = hasValue ? text : (node === elements.hashrate ? HASHRATE_PLACEHOLDER : PLACEHOLDER);
    node.dataset.hasValue = String(hasValue);
}

function showWalletError(message) {
    elements.walletError.textContent = message;
    elements.walletError.dataset.visible = 'true';
    elements.wallet.setAttribute('aria-invalid', 'true');
    elements.wallet.focus();
    log(message, 'error');
}

function clearWalletError() {
    elements.walletError.dataset.visible = 'false';
    elements.walletError.textContent = '';
    elements.wallet.removeAttribute('aria-invalid');
}

// Log message to output
function log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = `log-line log-${type}`;
    line.textContent = `[${timestamp}] ${message}`;
    elements.logOutput.appendChild(line);
    elements.logOutput.scrollTop = elements.logOutput.scrollHeight;
}

// Utility functions
function formatBytes(bytes) {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(1)} GB`;
}

function formatNumber(num) {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
}

function formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
