/**
 * XMRig Multi Web - Pool Proxy (Stratum over WebSocket)
 * Handles communication with the mining pool via a WebSocket proxy.
 */

class PoolProxy {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.onJob = null;
        this.onClose = null;
        this.onError = null;
        this.onOpen = null;
        this.onAccepted = null;
        this.onRejected = null;

        this.currentJob = null;
        this.rpcId = 1;
    }

    /**
     * 連接至代理伺服器
     * @param {string} proxyUrl WebSocket 代理網址
     * @param {object} config 挖礦配置 (wallet, pool, pass)
     */
    connect(proxyUrl, config) {
        if (this.socket) {
            this.socket.close();
        }

        console.log(`Connecting to proxy: ${proxyUrl}`);
        this.socket = new WebSocket(proxyUrl);

        this.socket.onopen = () => {
            console.log('WebSocket connected');
            this.isConnected = true;
            this.login(config);
            if (this.onOpen) this.onOpen();
        };

        this.socket.onmessage = (event) => {
            this.handleMessage(JSON.parse(event.data));
        };

        this.socket.onclose = (event) => {
            const reason = event.reason || "Unknown";
            const code = event.code;
            console.log(`WebSocket closed. Code: ${code}, Reason: ${reason}`);
            this.isConnected = false;
            if (this.onClose) this.onClose();
        };

        this.socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            if (this.onError) this.onError(error);
        };
    }

    /**
     * 斷開連線
     */
    disconnect() {
        if (this.socket) {
            this.socket.close();
        }
    }

    /**
     * 發送 Stratum 訊息
     */
    send(method, params = {}) {
        if (!this.isConnected) return;

        const message = {
            id: this.rpcId++,
            jsonrpc: "2.0",
            method: method,
            params: params
        };

        this.socket.send(JSON.stringify(message));
    }

    /**
     * 登入礦池 (Stratum Login)
     * 支援 Monero (rx/0), Wownero (rx/wow), DERO (astrobwt/v3)
     */
    login(config) {
        // 根據幣種選擇演算法
        const algoMap = {
            'monero': 'rx/0',
            'wownero': 'rx/wow',
            'dero': 'astrobwt/v3'
        };

        const coin = config.coin || 'monero';
        const algo = algoMap[coin] || 'rx/0';

        this.send("login", {
            login: config.walletAddress,
            pass: config.password || "x",
            agent: "xmrig-web-miner/1.0",
            algo: algo,
            coin: coin,
            pool: config.pool || "supportxmr" // Pool selection for proxy
        });
    }

    /**
     * 提交 Share
     */
    submit(jobId, nonce, result) {
        this.send("submit", {
            job_id: jobId,
            nonce: nonce,
            result: result
        });
    }

    /**
     * 處理伺服器回傳訊息
     */
    handleMessage(data) {
        // 處理結果 (如 Login 成功或 Share 被接受)
        if (data.result) {
            if (data.result.job) {
                this.updateJob(data.result.job);
            } else if (data.result.status === "OK") {
                if (this.onAccepted) this.onAccepted();
            }
        }

        // 處理推送 Job
        if (data.method === "job") {
            this.updateJob(data.params);
        }

        // 處理錯誤
        if (data.error) {
            console.error("Pool error:", data.error.message);
            if (this.onRejected) this.onRejected(data.error.message);
        }
    }

    /**
     * 更新當前 Job
     */
    updateJob(job) {
        this.currentJob = job;
        console.log("New job received:", job.job_id);
        if (this.onJob) this.onJob(job);
    }
}

export default PoolProxy;
