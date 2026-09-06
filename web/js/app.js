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

class App {
    constructor() {
        this.miner = new Miner();
        this.dom = {
            coinSelect: document.getElementById('coin-select'),
            walletAddress: document.getElementById('wallet-address'),
            walletLabel: document.getElementById('wallet-label'),
            walletHint: document.getElementById('wallet-hint'),
            poolSelect: document.getElementById('pool-select'),
            customProxyGroup: document.getElementById('custom-proxy-group'),
            customProxyUrl: document.getElementById('custom-proxy-url'),
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

    init() {
        this.dom.startBtn.addEventListener('click', () => this.startMining());
        this.dom.stopBtn.addEventListener('click', () => this.stopMining());
        this.dom.coinSelect.addEventListener('change', () => this.onCoinSelectChange());
        this.dom.poolSelect.addEventListener('change', () => this.onPoolSelectChange());

        // Build thread options before restoring saved selection (#47).
        this.renderThreadOptions();
        this.loadSettings();

        this.miner.onLog = (msg) => this.log(msg);
        this.miner.onStatsUpdate = (stats) => this.updateUI(stats);

        this.onCoinSelectChange();
        this.onPoolSelectChange();

        const supported = Object.entries(WEB_ENGINE_CAPABILITIES.coins)
            .filter(([, v]) => v.status === 'supported')
            .map(([k]) => k)
            .join(', ');
        this.log(`Web Miner 就緒 — 可啟動幣種: ${supported || '無'}（能力閘門 #26）`);
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
        const isCustom = this.dom.poolSelect.value === 'custom';
        this.dom.customProxyGroup.style.display = isCustom ? 'block' : 'none';
    }

    loadSettings() {
        const settings = JSON.parse(localStorage.getItem('xmrig_web_settings') || '{}');
        if (settings.coinSelect) this.dom.coinSelect.value = settings.coinSelect;
        if (settings.walletAddress) this.dom.walletAddress.value = settings.walletAddress;
        if (settings.poolSelect) this.dom.poolSelect.value = settings.poolSelect;
        if (settings.customProxyUrl) this.dom.customProxyUrl.value = settings.customProxyUrl;
        if (settings.threads) this.dom.threads.value = settings.threads;
        if (settings.workerName) this.dom.workerName.value = settings.workerName;
    }

    saveSettings() {
        const settings = {
            coinSelect: this.dom.coinSelect.value,
            walletAddress: this.dom.walletAddress.value,
            poolSelect: this.dom.poolSelect.value,
            customProxyUrl: this.dom.customProxyUrl.value,
            threads: this.dom.threads.value,
            workerName: this.dom.workerName.value
        };
        localStorage.setItem('xmrig_web_settings', JSON.stringify(settings));
    }

    renderThreadOptions() {
        const cores = navigator.hardwareConcurrency || 4;
        const previous = this.dom.threads.value;
        this.dom.threads.innerHTML = '';
        for (let i = 1; i <= cores; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.text = `${i} Threads`;
            if (i === Math.max(1, Math.floor(cores / 2))) option.selected = true;
            this.dom.threads.appendChild(option);
        }
        if (previous && [...this.dom.threads.options].some((o) => o.value === previous)) {
            this.dom.threads.value = previous;
        }
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

        let proxyUrl;
        let poolKey;
        if (isCustomProxy) {
            proxyUrl = this.dom.customProxyUrl.value.trim();
            poolKey = null;
        } else {
            proxyUrl = 'ws://localhost:3333';
            poolKey = poolSelection;
        }

        const config = {
            walletAddress,
            pool: poolKey,
            coin: coinSelection,
            threads: parseInt(this.dom.threads.value, 10),
            workerName: this.dom.workerName.value.trim() || 'web-worker',
            password: this.dom.workerName.value.trim() || 'x',
            proxy: proxyUrl
        };

        if (!config.proxy.startsWith('ws://') && !config.proxy.startsWith('wss://')) {
            alert('代理地址必須以 ws:// 或 wss:// 開頭');
            return;
        }

        this.saveSettings();
        this.log(`開始挖礦 ${coinConfig.name} (${coinConfig.symbol})`);
        this.log(`使用礦池: ${isCustomProxy ? '自訂代理' : poolSelection}`);
        this.log(`演算法: ${coinConfig.algorithm}`);
        this.miner.start(config);

        this.dom.startBtn.disabled = true;
        this.dom.stopBtn.disabled = false;
        this.dom.walletAddress.readOnly = true;
        this.dom.coinSelect.disabled = true;
        this.dom.poolSelect.disabled = true;
        this.dom.customProxyUrl.disabled = true;
        this.dom.threads.disabled = true;
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
    }

    updateUI(stats) {
        this.dom.hashrate.textContent = stats.hashrate.toFixed(1);
        this.dom.hashes.textContent = stats.totalHashes;
        this.dom.shares.textContent = `${stats.acceptedShares} / ${stats.rejectedShares}`;
        this.dom.uptime.textContent = this.formatUptime(stats.uptime);

        // Placeholder bar until #54 wires a real measurement.
        const progress = (Date.now() % 2000) / 20;
        this.dom.cpuUsage.style.width = stats.isMining ? `${progress}%` : '0%';
        this.dom.cpuUsage.title = '示意動畫，非實際 CPU 使用率 (#54)';
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
