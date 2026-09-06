// XMRig Multi Desktop - Frontend
import { invoke } from '@tauri-apps/api/core';
import {
    getActiveProfile,
    loadDesktopStore,
    saveDesktopStore
} from './settings.js';

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
    customPoolGroup: document.getElementById('custom-pool-group'),
    customPoolUrl: document.getElementById('custom-pool-url'),
    wallet: document.getElementById('wallet'),
    worker: document.getElementById('worker'),
    threads: document.getElementById('threads'),
    threadValue: document.getElementById('thread-value'),
    startBtn: document.getElementById('start-btn'),
    stopBtn: document.getElementById('stop-btn'),
    saveBtn: document.getElementById('save-settings-btn'),
    saveStatus: document.getElementById('save-status'),
    logOutput: document.getElementById('log-output'),
};

const poolConfigs = {
    monero: [
        { url: 'gulf.moneroocean.stream:10128', name: 'MoneroOcean (Recommended, XMR payout)', algo: 'rx/0', status: 'supported' },
        { url: 'pool.supportxmr.com:3333', name: 'SupportXMR', algo: 'rx/0', status: 'supported' },
        { url: 'pool.hashvault.pro:3333', name: 'HashVault', algo: 'rx/0', status: 'supported' },
        { url: 'xmr.2miners.com:2222', name: '2Miners', algo: 'rx/0', status: 'supported' },
    ],
    wownero: [
        { url: '', name: 'Wownero unavailable — need signer/daemon (#28)', algo: 'rx/wow', status: 'unavailable' },
    ],
    dero: [
        { url: '', name: 'DERO unavailable — need daemon adapter (#27)', algo: 'astrobwt/v3', status: 'unavailable' },
    ],
};

let statsInterval = null;
let isMining = false;
let settingsStore = null;
let cpuThreadCount = 4;
let dirty = false;

async function init() {
    log('Initializing XMRig Multi Desktop...');
    await loadSystemInfo();
    setupEventListeners();
    restoreSettings();
    log('Ready to mine!');
}

async function loadSystemInfo() {
    try {
        const info = await invoke('get_system_info');
        elements.cpuName.textContent = info.cpu_name;
        elements.cpuThreads.textContent = `${info.cpu_cores} / ${info.cpu_threads}`;
        elements.memory.textContent = formatBytes(info.memory_total);
        elements.osInfo.textContent = `${info.os_name} ${info.os_version} (${info.arch})`;
        cpuThreadCount = info.cpu_threads;
        elements.threads.max = info.cpu_threads;
        // Hardware default only if no saved profile yet — applied in restoreSettings.
        elements.threads.value = Math.max(1, info.cpu_threads - 1);
        elements.threadValue.textContent = elements.threads.value;
        log(`System: ${info.cpu_name}, ${info.cpu_threads} threads`);
    } catch (error) {
        log(`Error loading system info: ${error}`, 'error');
    }
}

function restoreSettings() {
    const loaded = loadDesktopStore(localStorage, cpuThreadCount);
    settingsStore = loaded.store;
    if (!loaded.ok) {
        setSaveStatus(`Load failed (${loaded.error}); using defaults`, true);
        log(`Settings load failed: ${loaded.error}`, 'error');
    } else if (loaded.fresh) {
        setSaveStatus('No saved profile yet — defaults from hardware');
    } else {
        setSaveStatus('Saved profile restored');
    }

    const profile = getActiveProfile(settingsStore);
    applyProfileToUi(profile);
}

function applyProfileToUi(profile) {
    elements.coinType.value = profile.coin_type || 'monero';
    updatePoolOptions();
    if (profile.use_custom_pool && profile.custom_pool_url) {
        elements.poolUrl.value = '__custom__';
        elements.customPoolUrl.value = profile.custom_pool_url;
        elements.customPoolGroup.style.display = 'block';
    } else if (profile.pool_url) {
        const match = [...elements.poolUrl.options].find((o) => o.value === profile.pool_url);
        if (match) {
            elements.poolUrl.value = profile.pool_url;
        } else {
            elements.poolUrl.value = '__custom__';
            elements.customPoolUrl.value = profile.pool_url;
            elements.customPoolGroup.style.display = 'block';
        }
    }
    elements.wallet.value = profile.wallet_address || '';
    elements.worker.value = profile.worker_name || 'desktop';
    const threads = Math.max(1, Math.min(cpuThreadCount, profile.threads || 1));
    elements.threads.value = threads;
    elements.threadValue.textContent = String(threads);
    dirty = false;
}

function collectProfileFromUi() {
    const useCustom = elements.poolUrl.value === '__custom__';
    const poolOption = elements.poolUrl.selectedOptions[0];
    return {
        id: settingsStore?.activeProfileId || 'default',
        name: getActiveProfile(settingsStore || { profiles: [{ id: 'default', name: 'Default' }] }).name || 'Default',
        coin_type: elements.coinType.value,
        pool_url: useCustom ? (elements.customPoolUrl.value.trim() || '') : elements.poolUrl.value,
        custom_pool_url: elements.customPoolUrl.value.trim(),
        use_custom_pool: useCustom,
        wallet_address: elements.wallet.value.trim(),
        worker_name: elements.worker.value.trim() || 'desktop',
        threads: parseInt(elements.threads.value, 10),
        algorithm: poolOption?.dataset?.algo || 'rx/0'
    };
}

function persistSettings() {
    if (!settingsStore) {
        settingsStore = loadDesktopStore(localStorage, cpuThreadCount).store;
    }
    const profile = collectProfileFromUi();
    settingsStore = {
        ...settingsStore,
        profiles: settingsStore.profiles.map((p) => (p.id === profile.id ? profile : p))
    };
    if (!settingsStore.profiles.some((p) => p.id === profile.id)) {
        settingsStore.profiles.push(profile);
    }
    settingsStore.activeProfileId = profile.id;
    const result = saveDesktopStore(settingsStore, localStorage);
    if (result.ok) {
        dirty = false;
        setSaveStatus('Saved');
        log('Settings saved');
    } else {
        setSaveStatus(`Save failed: ${result.error}`, true);
        log(`Settings save failed: ${result.error}`, 'error');
    }
    return result.ok;
}

function setSaveStatus(text, isError = false) {
    if (!elements.saveStatus) return;
    elements.saveStatus.textContent = text;
    elements.saveStatus.classList.toggle('error', isError);
}

function markDirty() {
    dirty = true;
    setSaveStatus('Unsaved changes');
}

function setupEventListeners() {
    elements.coinType.addEventListener('change', () => {
        updatePoolOptions();
        markDirty();
    });
    elements.poolUrl.addEventListener('change', () => {
        const custom = elements.poolUrl.value === '__custom__';
        elements.customPoolGroup.style.display = custom ? 'block' : 'none';
        markDirty();
    });
    elements.customPoolUrl.addEventListener('input', markDirty);
    elements.wallet.addEventListener('input', markDirty);
    elements.worker.addEventListener('input', markDirty);
    elements.threads.addEventListener('input', () => {
        elements.threadValue.textContent = elements.threads.value;
        markDirty();
    });
    elements.startBtn.addEventListener('click', startMining);
    elements.stopBtn.addEventListener('click', stopMining);
    elements.saveBtn?.addEventListener('click', () => persistSettings());
}

function updatePoolOptions() {
    const coin = elements.coinType.value;
    const pools = poolConfigs[coin] || poolConfigs.monero;
    const previous = elements.poolUrl.value;
    elements.poolUrl.innerHTML =
        pools.map((p) =>
            `<option value="${p.url}" data-algo="${p.algo}" data-status="${p.status || 'supported'}">${p.name}</option>`
        ).join('') +
        `<option value="__custom__" data-algo="rx/0" data-status="supported">Custom endpoint…</option>`;
    if ([...elements.poolUrl.options].some((o) => o.value === previous)) {
        elements.poolUrl.value = previous;
    }
    elements.customPoolGroup.style.display = elements.poolUrl.value === '__custom__' ? 'block' : 'none';
}

async function startMining() {
    const wallet = elements.wallet.value.trim();
    if (!wallet) {
        log('Please enter a wallet address', 'error');
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

    const useCustom = elements.poolUrl.value === '__custom__';
    const poolUrl = useCustom ? elements.customPoolUrl.value.trim() : elements.poolUrl.value;
    const poolOption = elements.poolUrl.selectedOptions[0];
    if (!useCustom && (poolOption?.dataset?.status === 'unavailable' || !poolUrl)) {
        log('Selected pool is unavailable', 'error');
        return;
    }
    if (!poolUrl) {
        log('Enter a custom pool endpoint', 'error');
        return;
    }
    const algo = poolOption?.dataset?.algo || 'rx/0';

    if (poolUrl.toLowerCase().includes('moneroocean')) {
        const isXmr = (wallet.startsWith('4') || wallet.startsWith('8')) && wallet.length >= 95;
        if (!isXmr) {
            log('MoneroOcean requires a Monero (XMR) payout address (#29)', 'error');
            return;
        }
    }

    persistSettings();

    const config = {
        pool_url: poolUrl,
        wallet_address: wallet,
        worker_name: elements.worker.value || 'desktop',
        threads: parseInt(elements.threads.value, 10),
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

function setMiningState(mining) {
    isMining = mining;
    elements.startBtn.disabled = mining;
    elements.stopBtn.disabled = !mining;
    elements.statusIndicator.className = `status-indicator ${mining ? 'mining' : ''}`;
    elements.miningStatus.textContent = mining ? 'Mining' : 'Stopped';
    elements.coinType.disabled = mining;
    elements.poolUrl.disabled = mining;
    elements.customPoolUrl.disabled = mining;
    elements.wallet.disabled = mining;
    elements.worker.disabled = mining;
    elements.threads.disabled = mining;
}

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

function stopStatsPolling() {
    if (statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
    }
    resetStats();
}

function updateStats(stats) {
    elements.hashrate.textContent = stats.hashrate.toFixed(2);
    elements.shares.textContent = `${stats.shares_accepted} / ${stats.shares_rejected}`;
    elements.difficulty.textContent = stats.difficulty > 0 ? formatNumber(stats.difficulty) : '-';
    elements.uptime.textContent = formatUptime(stats.uptime);
}

function resetStats() {
    elements.hashrate.textContent = '0.00';
    elements.shares.textContent = '0 / 0';
    elements.difficulty.textContent = '-';
    elements.uptime.textContent = '00:00:00';
}

function log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = `log-line log-${type}`;
    line.textContent = `[${timestamp}] ${message}`;
    elements.logOutput.appendChild(line);
    elements.logOutput.scrollTop = elements.logOutput.scrollHeight;
}

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

document.addEventListener('DOMContentLoaded', init);
