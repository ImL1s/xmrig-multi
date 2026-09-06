/**
 * XMRig Multi Web — console wiring.
 *
 * Presentation rules this file is responsible for:
 *  - the status panel reflects the miner's actual state, not the state we hoped for (#48/#54);
 *  - unknown numbers render as unknown rather than as zero (#54, via ./format.js);
 *  - capability gates from ./engine-capabilities.js decide what can start (#26–#29);
 *  - failures are reported next to the field that caused them, not in a modal alert (#58);
 *  - proxy is explicit (#50); WASM/COI preflight fail-closed lives in miner.js (#51).
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
import { parseAddressInput, validateWalletAddress } from '../../shared/wallet-address/js/validate.js';
import {
    HASHRATE_PLACEHOLDER,
    PLACEHOLDER,
    QUALITY_LABEL,
    count,
    elideAddress,
    hashrate,
    shareSuccessRate,
    uptime
} from './format.js';
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
            // setup
            coinSelect: document.getElementById('coin-select'),
            walletAddress: document.getElementById('wallet-address'),
            walletLabel: document.getElementById('wallet-label'),
            walletHint: document.getElementById('wallet-hint'),
            walletError: document.getElementById('wallet-error'),
            poolSelect: document.getElementById('pool-select'),
            proxyGroup: document.getElementById('proxy-group'),
            customProxyUrl: document.getElementById('custom-proxy-url'),
            proxyHint: document.getElementById('proxy-hint'),
            proxyError: document.getElementById('proxy-error'),
            proxyStatus: document.getElementById('proxy-status'),
            testProxyBtn: document.getElementById('test-proxy-btn'),
            threads: document.getElementById('threads'),
            workerName: document.getElementById('worker-name'),
            capabilityList: document.getElementById('capability-list'),
            stepPayout: document.getElementById('step-payout'),
            // actions
            startBtn: document.getElementById('start-btn'),
            stopBtn: document.getElementById('stop-btn'),
            startNote: document.getElementById('start-note'),
            // summary
            summaryEngine: document.getElementById('summary-engine'),
            summaryAlgo: document.getElementById('summary-algo'),
            summaryEndpoint: document.getElementById('summary-endpoint'),
            summaryWallet: document.getElementById('summary-wallet'),
            summaryThreads: document.getElementById('summary-threads'),
            // status
            stateChip: document.getElementById('state-chip'),
            stateText: document.getElementById('state-text'),
            stateDetail: document.getElementById('state-detail'),
            heroHashrate: document.getElementById('hero-hashrate'),
            heroWindow: document.getElementById('hero-window'),
            heroQuality: document.getElementById('hero-quality'),
            ledgerAccepted: document.getElementById('ledger-accepted'),
            ledgerRejected: document.getElementById('ledger-rejected'),
            ledgerSuccess: document.getElementById('ledger-success'),
            ledgerHashes: document.getElementById('ledger-hashes'),
            ledgerUptime: document.getElementById('ledger-uptime'),
            activityTrack: document.getElementById('activity-track'),
            activityNote: document.getElementById('activity-note'),
            // misc
            console: document.getElementById('console-output'),
            algoBadge: document.getElementById('algo-badge')
        };

        this.coinConfigs = {
            monero: {
                name: 'Monero',
                symbol: 'XMR',
                algorithm: 'RandomX',
                algorithmId: 'rx/0',
                walletLabel: 'Monero 錢包地址',
                walletHint: 'Monero 主網地址（標準/子地址/整合）會做 Keccak checksum 驗證 (#53)',
                walletPlaceholder: '4… 或 8…',
                validateAddress: (addr) => validateWalletAddress(addr, 'monero').ok
            },
            wownero: {
                name: 'Wownero',
                symbol: 'WOW',
                algorithm: 'RandomWOW (Web 未支援)',
                algorithmId: 'rx/wow',
                walletLabel: 'Wownero 錢包地址',
                walletHint: 'Web 後端尚未支援 RandomWOW／簽署流程 (#26/#28)',
                walletPlaceholder: 'Wo…',
                validateAddress: (addr) => validateWalletAddress(addr, 'wownero').ok
            },
            dero: {
                name: 'DERO',
                symbol: 'DERO',
                algorithm: 'AstroBWT/v3 (Web 未支援)',
                algorithmId: 'astrobwt/v3',
                walletLabel: 'DERO 錢包地址',
                walletHint: 'Web 後端尚未支援 DERO daemon 協定 (#27)',
                walletPlaceholder: 'dero…',
                validateAddress: (addr) => validateWalletAddress(addr, 'dero').ok
            }
        };

        this.init();
    }

    async init() {
        this.renderCapabilities();

        this.dom.startBtn.addEventListener('click', () => this.startMining());
        this.dom.stopBtn.addEventListener('click', () => this.stopMining());
        this.dom.coinSelect.addEventListener('change', () => this.onCoinSelectChange());
        this.dom.poolSelect.addEventListener('change', () => this.onPoolSelectChange());
        this.dom.testProxyBtn?.addEventListener('click', () => this.onTestProxy());
        this.dom.customProxyUrl?.addEventListener('change', () => {
            this.saveSettings();
            this.refreshProxyHint();
            this.refreshSummary();
        });

        // Keep the launch summary honest while the user is still typing.
        ['walletAddress', 'customProxyUrl', 'threads', 'workerName'].forEach((key) => {
            this.dom[key]?.addEventListener('input', () => this.refreshSummary());
        });
        this.dom.walletAddress.addEventListener('input', () => this.clearFieldError(this.dom.walletError));
        this.dom.customProxyUrl.addEventListener('input', () => {
            this.clearFieldError(this.dom.proxyError);
            this.setProxyStatus('');
        });

        this.miner.onLog = (msg) => this.log(msg);
        this.miner.onStatsUpdate = (stats) => this.updateUI(stats);
        this.miner.onProxyFailure = (detail) => {
            const diag = diagnoseProxyFailure({
                ...detail,
                pageProtocol: window.location.protocol,
                proxyUrl: this.dom.customProxyUrl?.value
            });
            this.setProxyStatus(diag.userMessage, true);
            this.showFieldError(this.dom.proxyError, this.dom.customProxyUrl, diag.userMessage);
            this.setState('fault', '連線失敗', diag.userMessage);
            this.log(`代理診斷 [${diag.layer}]: ${diag.userMessage}`, 'error');
            this.setSetupEnabled(true);
        };
        this.miner.onRuntimeFailure = (detail) => {
            const hints = (detail.actionHints || []).join(' / ');
            const message = `${detail.message}${hints ? ` — ${hints}` : ''}`;
            this.log(`執行環境失敗 [${detail.code}]: ${message}`, 'error');
            this.dom.startNote.textContent = message;
            this.setState('fault', '無法啟動', detail.message);
            this.setSetupEnabled(true);
        };

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.log('頁面隱藏 — 瀏覽器可能節流 workers（非原生同等持續算力）', 'warn');
            }
        });
        window.addEventListener('pagehide', () => {
            if (this.miner?.isMining) {
                this.log('pagehide — stopping mining to avoid leaked workers', 'warn');
                this.stopMining();
            }
        });

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
            this.log(`設定: ${w}`, 'warn');
        }
        if (!loaded.ok) {
            this.log(`設定載入降級: ${loaded.error}`, 'warn');
        }

        this.onCoinSelectChange();
        this.onPoolSelectChange();
        this.updateUI(this.miner.stats);

        const supported = Object.entries(WEB_ENGINE_CAPABILITIES.coins)
            .filter(([, v]) => v.status === 'supported')
            .map(([k]) => k)
            .join(', ');
        this.log(`Web Miner 就緒 — 可啟動幣種: ${supported || '無'}（能力閘門 #26）`);
    }

    async loadDeploymentConfig() {
        try {
            const res = await fetch(`${import.meta.env.BASE_URL}deployment.json`, { cache: 'no-store' });
            if (res.ok) {
                const json = await res.json();
                this.deployment = { ...this.deployment, ...json };
                this.log('部署設定已載入 (proxy source file)');
            }
        } catch {
            this.log('部署設定 deployment.json 不可用 — 僅使用頁面/使用者輸入', 'warn');
        }
    }

    ensureProxyField() {
        if (!this.dom.customProxyUrl) return;
        if (this.dom.proxyGroup) this.dom.proxyGroup.hidden = false;
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
            this.showFieldError(
                this.dom.proxyError,
                this.dom.customProxyUrl,
                resolved.error || '缺少代理 URL'
            );
            return;
        }
        this.clearFieldError(this.dom.proxyError);
        this.setProxyStatus('測試中…');
        this.log(`測試代理握手（不傳送錢包）: ${resolved.url}`);
        const result = await testProxyHandshake(resolved.url);
        this.setProxyStatus(result.userMessage, !result.ok);
        this.log(result.ok
            ? `代理握手成功 (${result.ms}ms)`
            : `代理握手失敗 [${result.layer}]: ${result.userMessage}`,
        result.ok ? 'info' : 'error');
    }

    // -- Step 1: capability report -----------------------------------------

    /**
     * Renders the packaged engine's real capabilities.
     *
     * Built from WEB_ENGINE_CAPABILITIES rather than hand-written copy, so the list cannot drift
     * away from the gate that actually blocks `start`.
     */
    renderCapabilities() {
        const list = this.dom.capabilityList;
        if (!list) return;
        list.textContent = '';

        for (const [coin, entry] of Object.entries(WEB_ENGINE_CAPABILITIES.coins)) {
            const supported = entry.status === 'supported';
            const algoId = entry.algorithms[0];
            const algo = WEB_ENGINE_CAPABILITIES.algorithms[algoId];
            const label = this.coinConfigs[coin]?.name || coin;

            const li = document.createElement('li');
            li.className = 'capability';
            li.dataset.status = entry.status;

            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            icon.setAttribute('class', 'capability__icon');
            icon.setAttribute('aria-hidden', 'true');
            icon.setAttribute('focusable', 'false');
            const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
            use.setAttribute('href', supported ? '#i-check' : '#i-blocked');
            icon.appendChild(use);

            const body = document.createElement('div');
            const name = document.createElement('div');
            name.className = 'capability__name';
            name.textContent = `${label} · ${algoId}`;
            const status = document.createElement('div');
            status.className = 'capability__status';
            status.textContent = supported
                ? `可啟動 — ${algo?.reason || '已驗證的路徑'}`
                : `不可用 — ${algo?.reason || '此瀏覽器後端未實作'}`;

            body.append(name, status);
            li.append(icon, body);
            list.appendChild(li);
        }
    }

    // -- Step 2/3: setup ----------------------------------------------------

    onCoinSelectChange() {
        const selectedCoin = this.dom.coinSelect.value;
        const config = this.coinConfigs[selectedCoin];
        if (!config) return;

        this.dom.walletLabel.textContent = config.walletLabel;
        this.dom.walletHint.textContent = config.walletHint;
        this.dom.walletAddress.placeholder = config.walletPlaceholder;
        this.dom.algoBadge.textContent = config.algorithm;
        this.clearFieldError(this.dom.walletError);

        this.filterPoolOptions(selectedCoin);

        const gate = assertWebCoinStartAllowed(selectedCoin);
        if (!gate.allowed) {
            this.log(`${config.name}: ${gate.status} — ${gate.reason}`, 'warn');
        } else {
            this.log(`切換至 ${config.name} (${config.symbol}) - 演算法: ${config.algorithm}`);
        }
        this.refreshSummary();
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
        if (this.dom.proxyGroup) this.dom.proxyGroup.hidden = false;
        this.clearFieldError(this.dom.proxyError);
        this.refreshProxyHint();
        this.refreshSummary();
    }

    /** Restores a validated settings model onto the controls. Blocked pools are never restored. */
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
                `已保存執行緒 ${settings.requestedThreads} 超出目前 ${navigator.hardwareConcurrency || '?'} 核，改用 ${settings.threads}`,
                'warn'
            );
        }
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
            this.log(`無法永久保存設定: ${result.error}`, 'warn');
            this.settingsPersistable = false;
        } else {
            this.settingsPersistable = true;
        }
    }

    renderThreadOptions(cores = navigator.hardwareConcurrency || 4) {
        const previous = this.dom.threads.value;
        this.dom.threads.innerHTML = '';
        for (let i = 1; i <= cores; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.text = `${i} / ${cores}`;
            if (i === Math.max(1, Math.floor(cores / 2))) option.selected = true;
            this.dom.threads.appendChild(option);
        }
        if (previous && [...this.dom.threads.options].some((o) => o.value === previous)) {
            this.dom.threads.value = previous;
        }
    }

    // -- Launch summary -----------------------------------------------------

    /** Endpoint the miner will actually dial, distinguished from the pool it routes to. */
    describeEndpoint() {
        const resolved = resolveProxyEndpoint(
            window.location,
            this.deployment,
            this.dom.customProxyUrl.value.trim()
        );
        if (!resolved.ok || !resolved.url) {
            return { text: resolved.error || '尚未填寫代理 URL', known: false };
        }
        if (this.dom.poolSelect.value === 'custom') {
            return { text: resolved.url, known: true };
        }
        const option = this.dom.poolSelect.options[this.dom.poolSelect.selectedIndex];
        const poolName = (option?.textContent || this.dom.poolSelect.value).trim();
        return { text: `${resolved.url} → ${poolName}`, known: true };
    }

    refreshSummary() {
        const coin = this.coinConfigs[this.dom.coinSelect.value];
        const wallet = this.dom.walletAddress.value.trim();

        this.dom.summaryAlgo.textContent = coin
            ? `${coin.algorithm} (${coin.algorithmId})`
            : PLACEHOLDER;

        const endpoint = this.describeEndpoint();
        this.dom.summaryEndpoint.textContent = endpoint.text;
        this.dom.summaryEndpoint.dataset.unknown = String(!endpoint.known);

        if (wallet) {
            this.dom.summaryWallet.textContent = `${coin?.symbol || ''} ${elideAddress(wallet)}`.trim();
            this.dom.summaryWallet.dataset.unknown = 'false';
        } else {
            this.dom.summaryWallet.textContent = '尚未填寫';
            this.dom.summaryWallet.dataset.unknown = 'true';
        }

        const threadOption = this.dom.threads.options[this.dom.threads.selectedIndex];
        this.dom.summaryThreads.textContent = threadOption
            ? `要求 ${threadOption.text}（實際配置由瀏覽器決定）`
            : PLACEHOLDER;

        // Step 2 is only complete once there is an address that passes its own format check.
        if (this.dom.stepPayout) {
            const ok = Boolean(wallet) && Boolean(coin?.validateAddress(wallet));
            this.dom.stepPayout.dataset.complete = String(ok);
        }

        const gate = assertWebCoinStartAllowed(this.dom.coinSelect.value);
        this.dom.startBtn.disabled = this.miner.isMining || !gate.allowed;
        this.dom.startNote.textContent = gate.allowed ? '' : gate.reason;
    }

    // -- Start / stop -------------------------------------------------------

    startMining() {
        const poolSelection = this.dom.poolSelect.value;
        const coinSelection = this.dom.coinSelect.value;
        const isCustomProxy = poolSelection === 'custom';
        const pasted = parseAddressInput(this.dom.walletAddress.value);
        if (!pasted.ok) {
            this.showFieldError(
                this.dom.walletError,
                this.dom.walletAddress,
                pasted.warnings[0] || '無效的地址貼上內容'
            );
            return;
        }
        if (pasted.address && pasted.address !== this.dom.walletAddress.value.trim()) {
            this.dom.walletAddress.value = pasted.address;
        }
        const walletAddress = pasted.address || this.dom.walletAddress.value.trim();
        const coinConfig = this.coinConfigs[coinSelection];

        const gate = assertWebCoinStartAllowed(coinSelection);
        if (!gate.allowed) {
            this.dom.startNote.textContent = gate.reason;
            this.log(`拒絕啟動: ${gate.reason}`, 'error');
            return;
        }

        if (!walletAddress) {
            this.showFieldError(this.dom.walletError, this.dom.walletAddress, '請輸入收款地址');
            return;
        }

        const walletCheck = validateWalletAddress(walletAddress, coinSelection);
        if (!walletCheck.ok) {
            this.showFieldError(
                this.dom.walletError,
                this.dom.walletAddress,
                walletCheck.message || `這不是有效的 ${coinConfig?.name || ''} 地址。${coinConfig?.walletHint || ''}`
            );
            return;
        }

        const moCheck = assertMoneroOceanPayoutAddress(poolSelection, coinSelection, walletAddress);
        if (!moCheck.ok) {
            this.showFieldError(this.dom.walletError, this.dom.walletAddress, moCheck.error);
            this.log(`拒絕啟動: ${moCheck.error}`, 'error');
            return;
        }

        const resolved = resolveProxyEndpoint(
            window.location,
            this.deployment,
            this.dom.customProxyUrl.value.trim()
        );
        if (!resolved.ok || !resolved.url) {
            this.showFieldError(
                this.dom.proxyError,
                this.dom.customProxyUrl,
                resolved.error || '請設定 WebSocket 代理 URL'
            );
            this.setProxyStatus(resolved.error || '缺少代理', true);
            this.log(`拒絕啟動: ${resolved.error || 'missing proxy'}`, 'error');
            return;
        }

        if (resolved.requiresRemoteConfirm) {
            const notice = resolved.trustNotice
                || '此為遠端代理：錢包登入會經過第三方。確認信任後才繼續。';
            if (!window.confirm(notice)) {
                this.log('使用者取消遠端代理確認', 'warn');
                return;
            }
        }

        if (!resolved.url.startsWith('ws://') && !resolved.url.startsWith('wss://')) {
            this.showFieldError(
                this.dom.proxyError,
                this.dom.customProxyUrl,
                '代理地址必須以 ws:// 或 wss:// 開頭'
            );
            return;
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
        this.log(`連線: ${this.describeEndpoint().text}`);
        this.log(`代理: ${resolved.url} [${resolved.source}/${resolved.kind}]`);
        this.miner.start(config);

        this.setSetupEnabled(false);
        // Connection is not yet established; say so rather than claiming we are mining (#48).
        this.setState('connecting', '正在連線', '等待代理與礦池回應');
        this.updateUI(this.miner.stats);
    }

    stopMining() {
        this.miner.stop();
        this.setSetupEnabled(true);
        this.setState('idle', '已停止', '');
        this.updateUI(this.miner.stats);
    }

    setSetupEnabled(enabled) {
        this.dom.startBtn.disabled = !enabled;
        this.dom.stopBtn.disabled = enabled;
        this.dom.walletAddress.readOnly = !enabled;
        this.dom.coinSelect.disabled = !enabled;
        this.dom.poolSelect.disabled = !enabled;
        this.dom.customProxyUrl.disabled = !enabled;
        this.dom.threads.disabled = !enabled;
        // Worker name only applies on the next start; lock it while mining like desktop does.
        if (this.dom.workerName) this.dom.workerName.disabled = !enabled;
        if (this.dom.testProxyBtn) this.dom.testProxyBtn.disabled = !enabled;
        if (enabled) this.refreshSummary();
    }

    // -- Status rendering ---------------------------------------------------

    /**
     * @param {'idle'|'connecting'|'mining'|'fault'} state
     */
    setState(state, text, detail) {
        this.dom.stateChip.dataset.state = state;
        this.dom.stateText.textContent = text;
        this.dom.stateDetail.textContent = detail || '';
    }

    /** Writes a ledger cell, or a dash when the figure is not something we actually know. */
    setLedger(node, text, hasValue) {
        node.textContent = hasValue ? text : PLACEHOLDER;
        node.dataset.hasValue = String(hasValue);
    }

    updateUI(stats) {
        const isMining = Boolean(this.miner.isMining);
        const rate = hashrate(stats.hashrate, isMining);

        this.dom.heroHashrate.textContent = rate.hasValue ? rate.text : HASHRATE_PLACEHOLDER;
        this.dom.heroHashrate.dataset.hasValue = String(rate.hasValue);
        this.dom.heroWindow.textContent = isMining ? '最近 2 秒平均' : '目前算力';
        this.dom.heroQuality.dataset.quality = rate.quality;
        // A stopped miner has no reading because nothing is running, which is not the same as the
        // browser being unable to measure it. Say the former rather than reusing the latter's word.
        this.dom.heroQuality.textContent = isMining
            ? QUALITY_LABEL[rate.quality]
            : '尚未啟動';

        // Before any session has run there is nothing to count, and "0 accepted / 0:00:00" reads
        // as a measurement rather than an absence. Once a session starts the real numbers show,
        // zeros included, because then the zero is the news (#54).
        const hasSession = isMining
            || stats.uptime > 0
            || stats.totalHashes > 0
            || stats.acceptedShares > 0
            || stats.rejectedShares > 0;

        this.setLedger(this.dom.ledgerAccepted, count(stats.acceptedShares), hasSession);
        this.setLedger(this.dom.ledgerRejected, count(stats.rejectedShares), hasSession);
        this.setLedger(this.dom.ledgerHashes, count(stats.totalHashes), hasSession);
        this.setLedger(this.dom.ledgerUptime, uptime(stats.uptime).text, hasSession);

        const success = shareSuccessRate(stats.acceptedShares, stats.rejectedShares);
        this.setLedger(this.dom.ledgerSuccess, success.text, hasSession && success.hasValue);

        // Activity, not CPU load. The browser exposes no trustworthy per-process CPU figure, so
        // this only reports whether workers are turning over hashes (#54).
        const active = isMining && rate.hasValue;
        this.dom.activityTrack.dataset.active = String(active);
        this.dom.activityNote.textContent = active
            ? '執行緒運轉中（非 CPU 使用率）'
            : isMining
                ? '尚未收到雜湊回報'
                : '閒置';

        if (isMining && rate.hasValue) {
            this.setState('mining', '挖礦中', '已收到礦池工作');
        } else if (isMining) {
            this.setState('connecting', '正在啟動', '等待第一批雜湊樣本');
        } else if (this.dom.stateChip.dataset.state !== 'fault') {
            this.setState('idle', '已停止', '');
        }
    }

    // -- Errors and logging -------------------------------------------------

    showFieldError(errorEl, inputEl, message) {
        if (!errorEl) return;
        const span = errorEl.querySelector('span');
        if (span) span.textContent = message;
        errorEl.dataset.visible = 'true';
        if (inputEl) {
            inputEl.setAttribute('aria-invalid', 'true');
            inputEl.focus();
        }
        this.log(message, 'error');
    }

    clearFieldError(errorEl) {
        if (!errorEl || errorEl.dataset.visible !== 'true') return;
        errorEl.dataset.visible = 'false';
        const span = errorEl.querySelector('span');
        if (span) span.textContent = '';
        const described = document.querySelector(`[aria-describedby~="${errorEl.id}"]`);
        described?.removeAttribute('aria-invalid');
    }

    /** @param {'info'|'warn'|'error'} level */
    log(message, level = 'info') {
        const entry = document.createElement('div');
        entry.className = 'log__entry';
        entry.dataset.level = level;

        const time = document.createElement('span');
        time.className = 'log__time';
        time.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });

        const text = document.createElement('span');
        text.className = 'log__text';
        text.textContent = message;

        entry.append(time, text);
        this.dom.console.appendChild(entry);
        this.dom.console.scrollTop = this.dom.console.scrollHeight;

        while (this.dom.console.children.length > 200) {
            this.dom.console.removeChild(this.dom.console.firstChild);
        }
    }
}

window.addEventListener('load', () => {
    new App();
});
