# XMRig Multi — Web

基於 [randomx.js](https://github.com/l1mey112/randomx.js) 的網頁版 Monero 礦工（**XMRig Multi** 網頁端）。

> ⚠️ **注意**：網頁挖礦效能較低（約 15-25 H/s），僅供展示和學習用途。

## 功能

- 🎨 現代化深色主題 UI
- ⛏️ RandomX 算法支援
- 📊 即時算力監控
- 🔧 可調整 CPU 執行緒數
- 📋 即時日誌輸出

## 快速開始

### 安裝依賴

```bash
cd web
npm install
```

### 開發模式

```bash
npm run dev
```

訪問 http://localhost:5173

### 生產構建

```bash
npm run build
```

## 使用說明

1. 輸入你的 Monero 錢包地址（以 `4` 開頭）
2. 選擇礦池（預設 MoneroOcean）
3. 調整 CPU 執行緒數
4. 點擊「開始挖礦」

## 技術架構

```
web/
├── index.html      # 主頁面
├── css/
│   └── style.css   # 深色主題樣式
├── js/
│   ├── app.js      # 應用控制器
│   └── miner.js    # 挖礦邏輯
└── package.json    # npm 設定
```

## 效能預期

| 環境 | 預期算力 |
|------|----------|
| 桌面瀏覽器 | 15-25 H/s |
| 手機瀏覽器 | 5-10 H/s |

## 注意事項

- 網頁挖礦會增加 CPU 負載
- 長時間運行可能導致設備發熱
- 實際收益非常低，請勿期望獲利

## 連接礦池

由於瀏覽器安全限制，無法直接連接 Stratum 礦池。如需完整功能，需要設置 WebSocket 代理伺服器。

推薦使用：[xmr-node-proxy](https://github.com/Snipa22/xmr-node-proxy) 的 WebSocket 分支。

## 授權

GPL-3.0 License
