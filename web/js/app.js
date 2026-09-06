/**
 * XMRig Multi Web - Application Logic
 * Handles UI interactions and miner control.
 */

import Miner from './miner.js';
import {
    assertMoneroOceanPayoutAddress,
    assertWebCoinStartAllowed,
    WEB_ENGINE_CAPABILITIES
} from './engine-capabilities.js';
import {
    loadWebSettingsFromStorage,
    saveWebSettingsToStorage
} from './web-settings.js';
import {
    diagnoseProxyFailure,
    resolveProxyEndpoint,
    testProxyHandshake
} from './proxy-config.js';

class App {
    constructor() {
        this.miner = new Miner();
        this.deployment = { allowDevLocalhostDefault: true };
        this.dom = {
            coinSelect: document.getElementById('coin-select'),
            walletAddress: document.getElementById('wallet-address'),
            walletLabel: document.getElementById('wallet-label'),
            walletHint: document.getElementById('wallet-hint'),
            poolSelect: document.getElementById('pool-select'),
            proxyGroup: document.getElementById('proxy-group'),
            customProxyUrl: document.getElementById('custom-proxy-url'),
            proxyHint: document.getElementById('proxy-hint'),
            proxyStatus: document.getElementById('proxy-status'),
            testProxyBtn: document.getElementById('test-proxy-btn'),
            threads: document.getElementById('threads'),
            workerName: document.getElementById('worker-name'),
            startBtn: document.getElementById('start-btn'),
            stopBtn: document.getElementById('stop-btn'),
            hashrate: document.getElementById('hashrate'),
            hashes: document.getElementById('hashes'),
            shares: document.getElementById('shares'),
            uptime: document.getElementById('uptime'),
            console: document.getElementById('console-output'),
            cpuUsage: document.getElementById('cpu-usage'),
            algoBadge: document.getElementById('algo-badge')
        };

        this.coinConfigs = {
            monero: {
                name: 'Monero',
                symbol: 'XMR',
                algorithm: 'RandomX',
                walletLabel: 'Monero 錢包地址',
                walletHint: 'Monero 地址以 4 或 8 開頭',
                walletPlaceholder: '4...',
                validateAddress: (addr) => (addr.startsWith('4') || addr.startsWith('8')) && addr.length >= 95
            },
            wownero: {
                name: 'Wownero',
                symbol: 'WOW',
                algorithm: 'RandomWOW (Web 未支援)',
                walletLabel: 'Wownero 錢包地址',
                walletHint: 'Web 後端尚未支援 RandomWOW／簽署流程 (#26/#28)',
                walletPlaceholder: 'Wo...',
                validateAddress: (addr) => addr.startsWith('Wo') && addr.length >= 95
            },
            dero: {
                name: 'DERO',
                symbol: 'DERO',
                algorithm: 'AstroBWT/v3 (Web 未支援)',
                walletLabel: 'DERO 錢包地址',
                walletHint: 'Web 後端尚未支援 DERO daemon 協定 (#27)',
                walletPlaceholder: 'dero...',
                validateAddress: (addr) => addr.startsWith('dero') && addr.length >= 60
            }
        };

        this.init();
    }

    async init() {
        this.dom.startBtn.addEventListener('click', () => this.startMining());
        this.dom.stopBtn.addEventListener('click', () => this.stopMining());
        this.dom.coinSelect.addEventListener('change', () => this.onCoinSelectChange());
        this.dom.poolSelect.addEventListener('change', () => this.onPoolSelectChange());
        this.dom.testProxyBtn?.addEventListener('click', () => this.onTestProxy());
        this.dom.customProxyUrl?.addEventListener('change', () => this.saveSettings());

        this.miner.onLog = (msg) => this.log(msg);
        this.miner.onStatsUpdate = (stats) => this.updateUI(stats);
        this.miner.onProxyFailure = (detail) => {
            const diag = diagnoseProxyFailure({
                ...detail,
                pageProtocol: window.location.protocol,
                proxyUrl: this.dom.customProxyUrl?.value
            });
            this.setProxyStatus(diag.userMessage, true);
            this.log(`代理診斷 [${diag.layer}]: ${diag.userMessage}`);
        };

        await this.loadDeploymentConfig();

        // Model first, then options, then apply — do not let render overwrite saved threads (#47).
        const cores = navigator.hardwareConcurrency || 4;
        const loaded = loadWebSettingsFromStorage(localStorage, { cores });
        this.settingsModel = loaded.settings;
        this.settingsPersistable = loaded.ok;
        this.renderThreadOptions(cores);
        this.applySettingsModel(this.settingsModel);
        this.ensureProxyField();
        for (const w of loaded.warnings || []) {
            this.log(`設定: ${w}`);
        }
        if (!loaded.ok) {
            this.log(`設定載入降級: ${loaded.error}`);
        }

        this.onCoinSelectChange();
        this.onPoolSelectChange();

        const supported = Object.entries(WEB_ENGINE_CAPABILITIES.coins)
            .filter(([, v]) => v.status === 'supported')
            .map(([k]) => k)
            .join(', ');
        this.log(`Web Miner 就緒 — 可啟動幣種: ${supported || '無'}（能力閘門 #26）`);
        this.updateActivityMeter(false);
    }

    async loadDeploymentConfig() {
        try {
            const res = await fetch(`${import.meta.env.BASE_URL}deployment.json`, { cache: 'no-store' });
            if (res.ok) {
                const json = await res.json();
                this.deployment = { ...this.deployment, ...json };
                this.log(`部署設定已載入 (proxy source file)`);
            }
        } catch {
            this.log('部署設定 deployment.json 不可用 — 僅使用頁面/使用者輸入');
        }
    }

    ensureProxyField() {
        if (!this.dom.customProxyUrl) return;
        if (this.dom.customProxyUrl.value.trim()) {
            this.refreshProxyHint();
            return;
        }
        const resolved = resolveProxyEndpoint(window.location, this.deployment, '');
        if (resolved.ok && resolved.url) {
            this.dom.customProxyUrl.value = resolved.url;
            this.log(`代理預填來源: ${resolved.source} (${resolved.kind})`);
        } else {
            this.setProxyStatus(resolved.error || '請設定 WebSocket 代理', true);
        }
        this.refreshProxyHint(resolved);
    }

    refreshProxyHint(resolved) {
        const r = resolved || resolveProxyEndpoint(
            window.location,
            this.deployment,
            this.dom.customProxyUrl?.value || ''
        );
        if (this.dom.proxyHint) {
            const trust = r.trustNotice || this.deployment.trustNotice || '';
            this.dom.proxyHint.textContent =
                `來源: ${r.source || 'user'} / ${r.kind || 'user'}. ${trust}`.trim();
        }
    }

    setProxyStatus(text, isError = false) {
        if (!this.dom.proxyStatus) return;
        this.dom.proxyStatus.textContent = text || '';
        this.dom.proxyStatus.classList.toggle('error', Boolean(isError));
    }

    async onTestProxy() {
        const resolved = resolveProxyEndpoint(
            window.location,
            this.deployment,
            this.dom.customProxyUrl.value.trim()
        );
        if (!resolved.ok || !resolved.url) {
            this.setProxyStatus(resolved.error || '缺少代理 URL', true);
            return;
        }
        this.setProxyStatus('測試中…');
        this.log(`測試代理握手（不傳送錢包）: ${resolved.url}`);
        const result = await testProxyHandshake(resolved.url);
        this.setProxyStatus(result.userMessage, !result.ok);
        this.log(result.ok
            ? `代理握手成功 (${result.ms}ms)`
            : `代理握手失敗 [${result.layer}]: ${result.userMessage}`);
    }

    applySettingsModel(settings) {
        if (settings.coinSelect) this.dom.coinSelect.value = settings.coinSelect;
        if (settings.walletAddress != null) this.dom.walletAddress.value = settings.walletAddress;
        if (settings.poolSelect) {
            const opt = [...this.dom.poolSelect.options].find((o) => o.value === settings.poolSelect);
            if (opt && !opt.disabled) this.dom.poolSelect.value = settings.poolSelect;
        }
        if (settings.customProxyUrl != null) this.dom.customProxyUrl.value = settings.customProxyUrl;
        if (settings.threads != null) this.dom.threads.value = String(settings.threads);
        if (settings.workerName != null) this.dom.workerName.value = settings.workerName;
        if (settings.requestedThreads && settings.requestedThreads !== settings.threads) {
            this.log(
                `已保存執行緒 ${settings.requestedThreads} 超出目前 ${navigator.hardwareConcurrency || '?'} 核，改用 ${settings.threads}`
            );
        }
    }

    loadSettings() {
        // Kept for compatibility; init uses loadWebSettingsFromStorage.
        const cores = navigator.hardwareConcurrency || 4;
        const loaded = loadWebSettingsFromStorage(localStorage, { cores });
        this.applySettingsModel(loaded.settings);
    }

    saveSettings() {
        const settings = {
            coinSelect: this.dom.coinSelect.value,
            walletAddress: this.dom.walletAddress.value,
            poolSelect: this.dom.poolSelect.value,
            customProxyUrl: this.dom.customProxyUrl.value,
            threads: parseInt(this.dom.threads.value, 10),
            workerName: this.dom.workerName.value
        };
        this.settingsModel = settings;
        const result = saveWebSettingsToStorage(settings, localStorage);
        if (!result.ok) {
            this.log(`無法永久保存設定: ${result.error}`);
            this.settingsPersistable = false;
        } else {
            this.settingsPersistable = true;
        }
    }

    renderThreadOptions(cores = navigator.hardwareConcurrency || 4) {
        this.dom.threads.innerHTML = '';
        for (let i = 1; i <= cores; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.text = `${i} Threads`;
            this.dom.threads.appendChild(option);
        }
    }

    onCoinSelectChange() {
        const selectedCoin = this.dom.coinSelect.value;
        const config = this.coinConfigs[selectedCoin];
        if (!config) return;

        if (this.dom.walletLabel) {
            this.dom.walletLabel.textContent = config.walletLabel;
        }
        if (this.dom.walletHint) {
            this.dom.walletHint.textContent = config.walletHint;
        }
        if (this.dom.walletAddress) {
            this.dom.walletAddress.placeholder = config.walletPlaceholder;
        }
        if (this.dom.algoBadge) {
            this.dom.algoBadge.textContent = config.algorithm;
        }

        this.filterPoolOptions(selectedCoin);

        const gate = assertWebCoinStartAllowed(selectedCoin);
        if (!gate.allowed) {
            this.log(`${config.name}: ${gate.status} — ${gate.reason}`);
            this.dom.startBtn.title = gate.reason;
        } else {
            this.dom.startBtn.title = '';
            this.log(`切換至 ${config.name} (${config.symbol}) - 演算法: ${config.algorithm}`);
        }
    }

    filterPoolOptions(coin) {
        const poolSelect = this.dom.poolSelect;
        const optgroups = poolSelect.querySelectorAll('optgroup');
        const coinToGroupId = {
            monero: 'xmr-pools',
            wownero: 'wow-pools',
            dero: 'dero-pools'
        };

        let firstValidOption = null;
        optgroups.forEach((group) => {
            const shouldShow = group.id === coinToGroupId[coin];
            group.style.display = shouldShow ? '' : 'none';
            group.querySelectorAll('option').forEach((opt) => {
                const blocked = opt.dataset.capability === 'unavailable';
                opt.disabled = !shouldShow || blocked;
                if (shouldShow && !blocked && !firstValidOption) {
                    firstValidOption = opt;
                }
            });
        });

        const currentOption = poolSelect.options[poolSelect.selectedIndex];
        const currentCoin = currentOption?.dataset?.coin;
        const currentBlocked = currentOption?.dataset?.capability === 'unavailable';
        if ((currentCoin !== coin || currentBlocked) && firstValidOption) {
            poolSelect.value = firstValidOption.value;
        } else if (currentCoin !== coin && !firstValidOption) {
            poolSelect.value = 'custom';
        }
    }

    onPoolSelectChange() {
        // Proxy field stays visible for all pool presets (#50).
        this.refreshProxyHint();
    }

    startMining() {
        const poolSelection = this.dom.poolSelect.value;
        const coinSelection = this.dom.coinSelect.value;
        const isCustomProxy = poolSelection === 'custom';
        const walletAddress = this.dom.walletAddress.value.trim();
        const coinConfig = this.coinConfigs[coinSelection];

        const gate = assertWebCoinStartAllowed(coinSelection);
        if (!gate.allowed) {
            alert(`無法啟動 ${coinConfig?.name || coinSelection}\n\n${gate.reason}`);
            this.log(`拒絕啟動: ${gate.reason}`);
            return;
        }

        if (!walletAddress) {
            alert('請輸入錢包地址');
            return;
        }

        if (coinConfig && !coinConfig.validateAddress(walletAddress)) {
            alert(`無效的 ${coinConfig.name} 錢包地址\n${coinConfig.walletHint}`);
            return;
        }

        const moCheck = assertMoneroOceanPayoutAddress(poolSelection, coinSelection, walletAddress);
        if (!moCheck.ok) {
            alert(moCheck.error);
            this.log(`拒絕啟動: ${moCheck.error}`);
            return;
        }

        const resolved = resolveProxyEndpoint(
            window.location,
            this.deployment,
            this.dom.customProxyUrl.value.trim()
        );
        if (!resolved.ok || !resolved.url) {
            alert(resolved.error || '請設定 WebSocket 代理 URL');
            this.setProxyStatus(resolved.error || '缺少代理', true);
            this.log(`拒絕啟動: ${resolved.error || 'missing proxy'}`);
            return;
        }

        if (resolved.requiresRemoteConfirm) {
            const notice = resolved.trustNotice
                || '此為遠端代理：錢包登入會經過第三方。確認信任後才繼續。';
            if (!window.confirm(notice)) {
                this.log('使用者取消遠端代理確認');
                return;
            }
        }

        const config = {
            walletAddress,
            pool: isCustomProxy ? null : poolSelection,
            coin: coinSelection,
            threads: parseInt(this.dom.threads.value, 10),
            workerName: this.dom.workerName.value.trim() || 'web-worker',
            password: this.dom.workerName.value.trim() || 'x',
            proxy: resolved.url
        };

        this.saveSettings();
        this.refreshProxyHint(resolved);
        this.log(`開始挖礦 ${coinConfig.name} (${coinConfig.symbol})`);
        this.log(`礦池 preset: ${isCustomProxy ? '自訂（僅代理）' : poolSelection}`);
        this.log(`代理: ${resolved.url} [${resolved.source}/${resolved.kind}]`);
        this.log(`演算法: ${coinConfig.algorithm}`);
        this.miner.start(config);

        this.dom.startBtn.disabled = true;
        this.dom.stopBtn.disabled = false;
        this.dom.walletAddress.readOnly = true;
        this.dom.coinSelect.disabled = true;
        this.dom.poolSelect.disabled = true;
        this.dom.customProxyUrl.disabled = true;
        this.dom.threads.disabled = true;
        if (this.dom.testProxyBtn) this.dom.testProxyBtn.disabled = true;
    }

    stopMining() {
        this.miner.stop();
        this.dom.startBtn.disabled = false;
        this.dom.stopBtn.disabled = true;
        this.dom.walletAddress.readOnly = false;
        this.dom.coinSelect.disabled = false;
        this.dom.poolSelect.disabled = false;
        this.dom.customProxyUrl.disabled = false;
        this.dom.threads.disabled = false;
        if (this.dom.testProxyBtn) this.dom.testProxyBtn.disabled = false;
    }

    updateUI(stats) {
        this.dom.hashrate.textContent = stats.hashrate.toFixed(1);
        this.dom.hashes.textContent = stats.totalHashes;
        this.dom.shares.textContent = `${stats.acceptedShares} / ${stats.rejectedShares}`;
        this.dom.uptime.textContent = this.formatUptime(stats.uptime);
        this.updateActivityMeter(stats.isMining);
    }

    /** Browsers have no trustworthy CPU % API — show activity, not a fake utilization (#54). */
    updateActivityMeter(isMining) {
        const bar = this.dom.cpuUsage;
        const label = document.getElementById('cpu-meter-label');
        if (!isMining) {
            bar.style.width = '0%';
            bar.classList.remove('is-active');
            bar.title = 'CPU 使用率：無法量測（瀏覽器無可信 API）';
            if (label) label.textContent = 'CPU：無法量測';
            return;
        }
        bar.style.width = '100%';
        bar.classList.add('is-active');
        bar.title = '挖礦活動中（非 CPU %）';
        if (label) label.textContent = '挖礦活動中（非 CPU %）';
    }

    formatUptime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    log(message) {
        const entry = document.createElement('div');
        entry.className = 'console-entry';
        const timestamp = new Date().toLocaleTimeString();
        entry.textContent = `[${timestamp}] ${message}`;
        this.dom.console.appendChild(entry);
        this.dom.console.scrollTop = this.dom.console.scrollHeight;
        while (this.dom.console.children.length > 100) {
            this.dom.console.removeChild(this.dom.console.firstChild);
        }
    }
}

window.addEventListener('load', () => {
    new App();
});
