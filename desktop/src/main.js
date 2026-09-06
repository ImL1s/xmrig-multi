// XMRig Multi Desktop - Frontend
import { invoke } from '@tauri-apps/api/core';
import {
    applyImport,
    createProfile,
    deleteProfile,
    duplicateProfile,
    exportDesktopStore,
    getActiveProfile,
    loadDesktopStore,
    previewImport,
    renameProfile,
    saveDesktopStore,
    switchProfile
} from './settings.js';
import { parseAddressInput, validateWalletAddress } from '../../shared/wallet-address/js/validate.js';
import generatedPools from './generated-pool-configs.json';
import registryJson from '../../shared/pool-registry/registry.v1.json';
import {
    recommendPools,
    estimateShareWait,
    firstShareStatus
} from '../../shared/pool-recommend/js/recommend.js';

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
    profileSelect: document.getElementById('profile-select'),
    profileNewBtn: document.getElementById('profile-new-btn'),
    profileDupBtn: document.getElementById('profile-dup-btn'),
    profileRenameBtn: document.getElementById('profile-rename-btn'),
    profileDeleteBtn: document.getElementById('profile-delete-btn'),
    coinType: document.getElementById('coin-type'),
    poolUrl: document.getElementById('pool-url'),
    poolRecommendHint: document.getElementById('pool-recommend-hint'),
    customPoolGroup: document.getElementById('custom-pool-group'),
    customPoolUrl: document.getElementById('custom-pool-url'),
    wallet: document.getElementById('wallet'),
    walletError: document.getElementById('wallet-error'),
    worker: document.getElementById('worker'),
    threads: document.getElementById('threads'),
    threadValue: document.getElementById('thread-value'),
    randomxMode: document.getElementById('randomx-mode'),
    startBtn: document.getElementById('start-btn'),
    stopBtn: document.getElementById('stop-btn'),
    saveBtn: document.getElementById('save-settings-btn'),
    exportBtn: document.getElementById('export-settings-btn'),
    importBtn: document.getElementById('import-settings-btn'),
    importFile: document.getElementById('import-file'),
    importPreview: document.getElementById('import-preview'),
    saveStatus: document.getElementById('save-status'),
    logOutput: document.getElementById('log-output'),
};

const poolConfigs = generatedPools.poolConfigs;

// Shown instead of a fabricated 0.00 before the miner has reported anything (#54).
const PLACEHOLDER = '\u2013';
const HASHRATE_PLACEHOLDER = '\u2013.\u2013\u2013';

let statsInterval = null;
let isMining = false;
let miningStartedAt = null;
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

    refreshProfileSelect();
    const profile = getActiveProfile(settingsStore);
    applyProfileToUi(profile);
}

function refreshProfileSelect() {
    if (!elements.profileSelect || !settingsStore) return;
    elements.profileSelect.innerHTML = settingsStore.profiles
        .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`)
        .join('');
    elements.profileSelect.value = settingsStore.activeProfileId;
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
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
    if (elements.randomxMode) {
        elements.randomxMode.value = profile.randomx_mode || 'auto';
    }
    dirty = false;
}

function collectProfileFromUi() {
    const useCustom = elements.poolUrl.value === '__custom__';
    const poolOption = elements.poolUrl.selectedOptions[0];
    const active = getActiveProfile(settingsStore || { profiles: [{ id: 'default', name: 'Default' }] });
    return {
        id: settingsStore?.activeProfileId || 'default',
        name: active.name || 'Default',
        coin_type: elements.coinType.value,
        pool_url: useCustom ? (elements.customPoolUrl.value.trim() || '') : elements.poolUrl.value,
        custom_pool_url: elements.customPoolUrl.value.trim(),
        use_custom_pool: useCustom,
        wallet_address: elements.wallet.value.trim(),
        worker_name: elements.worker.value.trim() || 'desktop',
        threads: parseInt(elements.threads.value, 10),
        algorithm: poolOption?.dataset?.algo || 'rx/0',
        randomx_mode: elements.randomxMode?.value || 'auto',
        locks: active.locks || [],
        localOverrides: { ...(active.localOverrides || {}), threads: true }
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
        refreshProfileSelect();
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

function syncActiveFromUiThen(mutator) {
    if (!settingsStore) return;
    const current = collectProfileFromUi();
    settingsStore = {
        ...settingsStore,
        profiles: settingsStore.profiles.map((p) => (p.id === current.id ? current : p))
    };
    const next = mutator(settingsStore);
    settingsStore = next.store || next;
    refreshProfileSelect();
    applyProfileToUi(getActiveProfile(settingsStore));
    persistSettings();
}

async function onProfileSwitch(profileId) {
    if (!settingsStore || profileId === settingsStore.activeProfileId) return;
    if (isMining) {
        const ok = window.confirm('Switching profiles stops mining. Continue?');
        if (!ok) {
            refreshProfileSelect();
            return;
        }
        await stopMining();
    } else if (dirty) {
        const ok = window.confirm('Discard unsaved changes and switch profile?');
        if (!ok) {
            refreshProfileSelect();
            return;
        }
    } else {
        // Keep current edits before leaving profile.
        const current = collectProfileFromUi();
        settingsStore = {
            ...settingsStore,
            profiles: settingsStore.profiles.map((p) => (p.id === current.id ? current : p))
        };
    }
    const switched = switchProfile(settingsStore, profileId);
    if (!switched.ok) {
        setSaveStatus(switched.error, true);
        return;
    }
    settingsStore = switched.store;
    applyProfileToUi(getActiveProfile(settingsStore));
    persistSettings();
    setSaveStatus(`Switched to ${getActiveProfile(settingsStore).name}`);
}

function setupEventListeners() {
    elements.coinType.addEventListener('change', () => {
        updatePoolOptions();
        markDirty();
    });
    elements.poolUrl.addEventListener('change', () => {
        const custom = elements.poolUrl.value === '__custom__';
        elements.customPoolGroup.style.display = custom ? 'block' : 'none';
        refreshPoolRecommendHintOnly();
        markDirty();
    });
    elements.customPoolUrl.addEventListener('input', markDirty);
    elements.wallet.addEventListener('input', () => {
        clearWalletError();
        markDirty();
    });
    elements.worker.addEventListener('input', markDirty);
    elements.threads.addEventListener('input', () => {
        elements.threadValue.textContent = elements.threads.value;
        markDirty();
    });
    elements.startBtn.addEventListener('click', startMining);
    elements.stopBtn.addEventListener('click', stopMining);
    elements.saveBtn?.addEventListener('click', () => persistSettings());
    elements.profileSelect?.addEventListener('change', () => onProfileSwitch(elements.profileSelect.value));
    elements.profileNewBtn?.addEventListener('click', () => {
        const name = window.prompt('New profile name', 'New profile');
        if (name == null) return;
        syncActiveFromUiThen((store) => createProfile(store, cpuThreadCount, name.trim() || 'New profile'));
        setSaveStatus('Profile created');
    });
    elements.profileDupBtn?.addEventListener('click', () => {
        syncActiveFromUiThen((store) => duplicateProfile(store, store.activeProfileId, cpuThreadCount));
        setSaveStatus('Profile duplicated');
    });
    elements.profileRenameBtn?.addEventListener('click', () => {
        const active = getActiveProfile(settingsStore);
        const name = window.prompt('Rename profile', active.name);
        if (name == null) return;
        syncActiveFromUiThen((store) => ({ store: renameProfile(store, store.activeProfileId, name) }));
        setSaveStatus('Profile renamed');
    });
    elements.profileDeleteBtn?.addEventListener('click', () => {
        const active = getActiveProfile(settingsStore);
        if (!window.confirm(`Delete profile "${active.name}"?`)) return;
        if (isMining) {
            window.alert('Stop mining before deleting the active profile.');
            return;
        }
        const result = deleteProfile(settingsStore, active.id);
        if (!result.ok) {
            setSaveStatus(result.error, true);
            return;
        }
        settingsStore = result.store;
        refreshProfileSelect();
        applyProfileToUi(getActiveProfile(settingsStore));
        persistSettings();
        setSaveStatus('Profile deleted');
    });
    elements.exportBtn?.addEventListener('click', () => {
        persistSettings();
        const payload = exportDesktopStore(settingsStore, { sourceCpuThreads: cpuThreadCount });
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'xmrig-desktop-settings.json';
        a.click();
        URL.revokeObjectURL(url);
        setSaveStatus('Exported (secrets excluded)');
    });
    elements.importBtn?.addEventListener('click', () => elements.importFile?.click());
    elements.importFile?.addEventListener('change', async () => {
        const file = elements.importFile.files?.[0];
        if (!file) return;
        try {
            const raw = JSON.parse(await file.text());
            const preview = previewImport(raw, cpuThreadCount);
            if (!preview.ok) {
                setSaveStatus(`Import failed: ${preview.error}`, true);
                return;
            }
            const reresolve = preview.preview.needsReresolve;
            let msg = `Import ${preview.preview.profileCount} profile(s)? Import never auto-starts mining.`;
            if (reresolve.length) {
                msg += `\n\nNeeds re-resolve on this host:\n` + reresolve
                    .map((r) => `- ${r.name}: ${r.items.map((i) => i.field).join(', ')}`)
                    .join('\n');
            }
            if (elements.importPreview) {
                elements.importPreview.hidden = false;
                elements.importPreview.textContent = msg;
            }
            if (!window.confirm(msg)) return;
            if (isMining) await stopMining();
            const applied = applyImport(preview.preview, localStorage);
            if (!applied.ok) {
                setSaveStatus(`Import save failed: ${applied.error}`, true);
                return;
            }
            settingsStore = applied.store;
            refreshProfileSelect();
            applyProfileToUi(getActiveProfile(settingsStore));
            setSaveStatus('Imported — review re-resolve items before mining');
            log('Settings imported (auto-start disabled)');
        } catch (e) {
            setSaveStatus(`Import failed: ${e.message || e}`, true);
        } finally {
            elements.importFile.value = '';
        }
    });
}

function updatePoolOptions() {
    const coin = elements.coinType.value;
    const pools = poolConfigs[coin] || poolConfigs.monero;
    const previous = elements.poolUrl.value;
    // Hashrate-aware labels (#42) — do not hardcode a single pool as "Recommended".
    const chain = coin === 'wownero' ? 'wownero' : coin === 'dero' ? 'dero' : 'monero';
    const asset = coin === 'wownero' ? 'WOW' : coin === 'dero' ? 'DERO' : 'XMR';
    const measuredHs = Number.parseFloat(elements.hashrate?.textContent);
    const hashrateHs = Number.isFinite(measuredHs) && measuredHs > 0 ? measuredHs : null;
    const ranked = recommendPools({
        entries: registryJson.entries || [],
        hashrateHs,
        miningChain: chain,
        payoutAsset: asset
    });
    const reasonById = new Map(ranked.recommendations.map((r) => [r.poolId, r]));

    elements.poolUrl.innerHTML =
        pools.map((p) => {
            const rec = reasonById.get(p.id);
            const tag = ranked.top?.poolId === p.id ? ' — suggested for current H/s' : '';
            return `<option value="${p.url}" data-algo="${p.algo}" data-pool-id="${p.id}" data-status="${p.status || 'supported'}">${p.name}${tag}</option>`;
        }).join('') +
        `<option value="__custom__" data-algo="rx/0" data-status="supported">Custom endpoint…</option>`;
    if ([...elements.poolUrl.options].some((o) => o.value === previous)) {
        elements.poolUrl.value = previous;
    }
    elements.customPoolGroup.style.display = elements.poolUrl.value === '__custom__' ? 'block' : 'none';
    updatePoolRecommendHint(ranked, reasonById);

    // Say up front that the coin cannot run, instead of accepting a click and then refusing it.
    const blocked = isCoinBlocked();
    if (!isMining) {
        elements.startBtn.disabled = blocked;
    }
    elements.startBtn.title = blocked
        ? `${coin.toUpperCase()} is not supported by this build`
        : '';
}

function updatePoolRecommendHint(ranked, reasonById) {
    if (!elements.poolRecommendHint) return;
    const selected = elements.poolUrl.selectedOptions[0];
    const poolId = selected?.dataset?.poolId;
    const rec = poolId ? reasonById.get(poolId) : ranked.top;
    if (!rec) {
        elements.poolRecommendHint.textContent =
            'Pool ranking uses measured hashrate affinity — not a payout guarantee (#42).';
        return;
    }
    const why = (rec.reasons || []).slice(0, 2).join('; ');
    const wait = estimateShareWait({
        difficulty: null,
        hashrateHs: ranked.hashrateHs
    });
    const shareNote = wait.ok
        ? wait.message
        : 'First-share wait needs a difficulty sample (VARDIFF) after a job arrives.';
    elements.poolRecommendHint.textContent =
        `${rec.displayName}: ${why}. ${shareNote} Ranking never auto-replaces your selection.`;
}

function refreshPoolRecommendHintOnly() {
    const coin = elements.coinType.value;
    const chain = coin === 'wownero' ? 'wownero' : coin === 'dero' ? 'dero' : 'monero';
    const asset = coin === 'wownero' ? 'WOW' : coin === 'dero' ? 'DERO' : 'XMR';
    const measuredHs = Number.parseFloat(elements.hashrate?.textContent);
    const hashrateHs = Number.isFinite(measuredHs) && measuredHs > 0 ? measuredHs : null;
    const ranked = recommendPools({
        entries: registryJson.entries || [],
        hashrateHs,
        miningChain: chain,
        payoutAsset: asset
    });
    updatePoolRecommendHint(ranked, new Map(ranked.recommendations.map((r) => [r.poolId, r])));
}

/** True when every preset for the selected coin is gated off, so nothing can legally start. */
function isCoinBlocked() {
    const pools = poolConfigs[elements.coinType.value] || poolConfigs.monero;
    return pools.every((p) => p.status === 'unavailable');
}

async function startMining() {
    const pasted = parseAddressInput(elements.wallet.value);
    if (!pasted.ok) {
        showWalletError(pasted.warnings[0] || 'Invalid wallet paste');
        return;
    }
    if (pasted.address && pasted.address !== elements.wallet.value.trim()) {
        elements.wallet.value = pasted.address;
        for (const w of pasted.warnings) log(w, 'info');
    }
    const wallet = pasted.address || elements.wallet.value.trim();
    if (!wallet) {
        showWalletError('Enter the address your payouts should go to.');
        return;
    }

    const coin = elements.coinType.value;
    const walletCheck = validateWalletAddress(wallet, coin);
    if (!walletCheck.ok) {
        showWalletError(walletCheck.message || 'Invalid wallet address');
        return;
    }
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
        if (walletCheck.network !== 'mainnet' || walletCheck.coin !== 'monero') {
            showWalletError('MoneroOcean pays out in XMR, so this must be a Monero mainnet address (#29).');
            return;
        }
    }

    clearWalletError();
    persistSettings();

    const config = {
        pool_url: poolUrl,
        wallet_address: wallet,
        worker_name: elements.worker.value || 'desktop',
        threads: parseInt(elements.threads.value, 10),
        coin_type: coin,
        algorithm: algo,
        randomx_mode: elements.randomxMode?.value || 'auto',
    };

    log(`Starting ${coin.toUpperCase()} mining...`);
    log(`Pool: ${config.pool_url}`);
    log(`Threads: ${config.threads}`);
    log(`RandomX mode: ${config.randomx_mode} (scratchpad ≠ full dataset RAM — #35)`);

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
    miningStartedAt = mining ? Date.now() : null;
    elements.startBtn.disabled = mining || isCoinBlocked();
    elements.stopBtn.disabled = !mining;
    elements.statusIndicator.className = `status-indicator ${mining ? 'mining' : ''}`;
    elements.miningStatus.textContent = mining ? 'Mining' : 'Stopped';
    elements.coinType.disabled = mining;
    elements.poolUrl.disabled = mining;
    elements.customPoolUrl.disabled = mining;
    elements.wallet.disabled = mining;
    elements.worker.disabled = mining;
    elements.threads.disabled = mining;
    if (elements.randomxMode) elements.randomxMode.disabled = mining;
    if (elements.profileSelect) elements.profileSelect.disabled = mining;
    if (elements.profileNewBtn) elements.profileNewBtn.disabled = mining;
    if (elements.profileDupBtn) elements.profileDupBtn.disabled = mining;
    if (elements.profileRenameBtn) elements.profileRenameBtn.disabled = mining;
    if (elements.profileDeleteBtn) elements.profileDeleteBtn.disabled = mining;
    if (elements.importBtn) elements.importBtn.disabled = mining;
}

function startStatsPolling() {
    statsInterval = setInterval(async () => {
        try {
            const running = await invoke('is_mining');
            if (!running && isMining) {
                log('Miner process exited — unlocking controls (#48)', 'error');
                setMiningState(false);
                stopStatsPolling();
                return;
            }
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
    // Match Android/Web honesty: a running miner that has not closed its first sampling window is
    // pending (–.––), not 0.00. Real zeros for shares stay numeric once a session is live.
    const rate = Number(stats.hashrate);
    const hasHashrate = Number.isFinite(rate) && rate > 0;
    setStat(elements.hashrate, hasHashrate ? rate.toFixed(2) : HASHRATE_PLACEHOLDER, hasHashrate);
    setStat(elements.shares, `${stats.shares_accepted} / ${stats.shares_rejected}`, true);
    setStat(elements.difficulty, formatNumber(stats.difficulty), stats.difficulty > 0);
    setStat(elements.uptime, formatUptime(stats.uptime), true);

    if (isMining && elements.poolRecommendHint) {
        const estimate = estimateShareWait({
            difficulty: stats.difficulty > 0 ? stats.difficulty : null,
            hashrateHs: hasHashrate ? rate : null
        });
        const waitedSeconds = miningStartedAt
            ? (Date.now() - miningStartedAt) / 1000
            : Number(stats.uptime) || 0;
        const status = firstShareStatus({
            acceptedShares: Number(stats.shares_accepted) || 0,
            hasJob: Number(stats.difficulty) > 0 || hasHashrate,
            authError: false,
            initializing: !hasHashrate && (Number(stats.shares_accepted) || 0) === 0,
            waitedSeconds,
            estimate
        });
        if (status.code !== 'share_accepted') {
            elements.poolRecommendHint.textContent = `${status.message}. ${estimate.disclaimer || ''}`.trim();
        }
    }
}

function resetStats() {
    setStat(elements.hashrate, HASHRATE_PLACEHOLDER, false);
    setStat(elements.shares, PLACEHOLDER, false);
    setStat(elements.difficulty, PLACEHOLDER, false);
    setStat(elements.uptime, PLACEHOLDER, false);
}

function setStat(node, text, hasValue) {
    const placeholder = node === elements.hashrate ? HASHRATE_PLACEHOLDER : PLACEHOLDER;
    node.textContent = hasValue ? text : placeholder;
    node.dataset.hasValue = String(hasValue);
}

/** Wallet problems belong beside the wallet field, not only at the bottom of the log. */
function showWalletError(message) {
    if (elements.walletError) {
        elements.walletError.textContent = message;
        elements.walletError.dataset.visible = 'true';
    }
    elements.wallet.setAttribute('aria-invalid', 'true');
    elements.wallet.focus();
    log(message, 'error');
}

function clearWalletError() {
    if (elements.walletError) {
        elements.walletError.dataset.visible = 'false';
        elements.walletError.textContent = '';
    }
    elements.wallet.removeAttribute('aria-invalid');
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
