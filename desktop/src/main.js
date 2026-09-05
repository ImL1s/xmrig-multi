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
    worker: document.getElementById('worker'),
    threads: document.getElementById('threads'),
    threadValue: document.getElementById('thread-value'),
    startBtn: document.getElementById('start-btn'),
    stopBtn: document.getElementById('stop-btn'),
    logOutput: document.getElementById('log-output'),
};

// Pool configurations per coin
const poolConfigs = {
    monero: [
        { url: 'gulf.moneroocean.stream:10128', name: 'MoneroOcean (Recommended)', algo: 'rx/0' },
        { url: 'pool.supportxmr.com:3333', name: 'SupportXMR', algo: 'rx/0' },
        { url: 'pool.hashvault.pro:3333', name: 'HashVault', algo: 'rx/0' },
        { url: 'xmr.2miners.com:2222', name: '2Miners', algo: 'rx/0' },
    ],
    wownero: [
        { url: 'wow.herominers.com:1111', name: 'HeroMiners WOW', algo: 'rx/wow' },
        { url: 'gulf.moneroocean.stream:10128', name: 'MoneroOcean (Multi)', algo: 'rx/wow' },
    ],
    dero: [
        { url: 'dero-node.mysrv.cloud:10100', name: 'DERO Community', algo: 'astrobwt/v3' },
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
    elements.startBtn.addEventListener('click', startMining);
    elements.stopBtn.addEventListener('click', stopMining);
}

// Update pool options based on selected coin
function updatePoolOptions() {
    const coin = elements.coinType.value;
    const pools = poolConfigs[coin] || poolConfigs.monero;

    elements.poolUrl.innerHTML = pools.map(p =>
        `<option value="${p.url}" data-algo="${p.algo}">${p.name}</option>`
    ).join('');
}

// Start mining
async function startMining() {
    const wallet = elements.wallet.value.trim();
    if (!wallet) {
        log('Please enter a wallet address', 'error');
        return;
    }

    const coin = elements.coinType.value;
    const poolOption = elements.poolUrl.selectedOptions[0];
    const algo = poolOption.dataset.algo || 'rx/0';

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
    elements.startBtn.disabled = mining;
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
    elements.hashrate.textContent = stats.hashrate.toFixed(2);
    elements.shares.textContent = `${stats.shares_accepted} / ${stats.shares_rejected}`;
    elements.difficulty.textContent = stats.difficulty > 0 ? formatNumber(stats.difficulty) : '-';
    elements.uptime.textContent = formatUptime(stats.uptime);
}

// Reset stats display
function resetStats() {
    elements.hashrate.textContent = '0.00';
    elements.shares.textContent = '0 / 0';
    elements.difficulty.textContent = '-';
    elements.uptime.textContent = '00:00:00';
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
