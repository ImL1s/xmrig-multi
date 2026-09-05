# XMRig Multi — 跨平台

[![Android CI](https://github.com/ImL1s/xmrig-multi/actions/workflows/android-ci.yml/badge.svg)](https://github.com/ImL1s/xmrig-multi/actions/workflows/android-ci.yml)
[![Web Miner CI](https://github.com/ImL1s/xmrig-multi/actions/workflows/web-miner-ci.yml/badge.svg)](https://github.com/ImL1s/xmrig-multi/actions/workflows/web-miner-ci.yml)
[![Release](https://github.com/ImL1s/xmrig-multi/actions/workflows/release.yml/badge.svg)](https://github.com/ImL1s/xmrig-multi/actions/workflows/release.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

**XMRig Multi** 是 ImL1s 的跨平台門羅幣／Wownero／DERO 挖礦應用：Android／iOS（sideload）／Desktop 走原生 XMRig，瀏覽器走 RandomX.js，WearOS／watchOS 為統計伴侶應用。

> 倉庫：[`ImL1s/xmrig-multi`](https://github.com/ImL1s/xmrig-multi)。產品顯示名稱：**XMRig Multi**。

| 平台 | 狀態 | 挖礦 | 說明 |
|------|------|------|------|
| **Android** | ✅ checkout 含 assets 備援 | 原生 XMRig | 礦池 + Monero Solo（`monerod`）；`./gradlew :app:assembleDebug` |
| **iOS** | ⚠️ tracked `.a` 為上游 donate | 原生 XMRig | App Store 禁止上架；要本倉庫費用須重建 |
| **Web** | ✅ Demo | RandomX.js | 需要本機 WebSocket proxy |
| **Desktop** | ⚠️ Linux 二進位已提交 | 原生 XMRig | macOS/Windows：`desktop/scripts/build-xmrig.sh` |
| **WearOS** | 伴侶應用 | 否 | `./gradlew :wearos:assembleDebug` |
| **watchOS** | 伴侶應用 | 否 | `cd watchos && xcodegen generate` |

[English](README.md) | [文件索引](docs/README.md) | [平台說明](docs/platforms.md) | [開發者費用](docs/dev-fee.md) | [編譯指南](docs/building.zh-TW.md) | [截圖](docs/screenshots/README.md)

---

## 快速開始

### Android

```bash
git clone https://github.com/ImL1s/xmrig-multi.git
cd xmrig-multi
./gradlew :app:assembleDebug
./gradlew :app:installDebug
```

Checkout 含 `app/src/main/assets/xmrig_arm64`（本倉庫 1% 費用錢包）。若 gitignore 的 `jniLibs/arm64-v8a/libxmrig.so` 不存在，Gradle（`:app:stageXmrigJniLib`）會把它打成 **arm64-v8a** `libxmrig.so`，Android 10+ 的 64 位元裝置才能執行。checkout 沒有 32 位元礦機。發佈前仍可用 `./scripts/build_xmrig.sh` 產出優先函式庫。

### iOS（Sideload）

Checkout 裡的 `ios/XMRigCore/output/libxmrig-ios-arm64.a` 是 XMRig 6.25.0，費用窗口走 **上游** `donate.v2.xmrig.com`，**不是**本倉庫的 `8AfU...` 錢包。Xcode 仍可連結它來 sideload。要套用本專案 1% 費用請見 [docs/ios.md](docs/ios.md)。

在倉庫根目錄執行（不要先 `cd` 進 `ios/XMRigCore/scripts`）：

```bash
open ./ios/XMRigMiner-iOS.xcodeproj
```

### Web

```bash
cd web/proxy && npm install && node server.js
cd web && npm install && npm run dev
# http://localhost:5173
```

### Desktop（macOS / Windows / Linux）

```bash
cd desktop && npm install
./scripts/build-xmrig.sh
npm run tauri:dev
```

---

## 功能

- 多幣種：Monero (XMR)、Wownero (WOW)、DERO
- 多礦池：MoneroOcean、SupportXMR、HashVault、2Miners 等
- Android Solo：連自架 `monerod` RPC（`daemon: true`）挖 Monero — 見 [docs/platforms.md](docs/platforms.md#android-solo-mining-monerod)
- 即時算力（10s / 60s / 15m）、接受/拒絕份額
- CPU 溫度與電池狀態（行動裝置）
- Android 8+ 無法讀系統 CPU 使用率（介面會顯示 0）；更舊版本才讀 `/proc/stat`

首次使用必須填自己的錢包；應用不會用開發者錢包當預設挖礦位址。

---

## 開發者費用

本應用包含 **1% 開發者費用**（時間制：99 分鐘使用者 → 1 分鐘開發者）。

- 錢包：`8AfUwcnoJiRDMXnDGj3zX6bMgfaj9pM1WFGr2pakLm3jSYXVLD5fcDMBzkmk4AeSqWYQTA5aerXJ43W65AT82RMqG6NDBnC`
- 原生平台：XMRig 編譯期 donate
- Web：`web/proxy/dev-fee.js` 在切換時重新 login（僅 Monero 連線；WOW/DERO 不改寫位址）

詳見 [docs/dev-fee.md](docs/dev-fee.md)。

---

## 預期效能

| 平台 | 裝置 | 算力 | 說明 |
|------|------|------|------|
| Android | Snapdragon 8 Gen 2 | 800-1200 H/s | 原生 XMRig |
| iOS | iPhone 11+ | 3-5 H/s | iOS 封鎖 JIT |
| iOS | JIT 開啟 | 200-400 H/s | 需 SideStore + StikDebug |
| Desktop | AMD Ryzen 9 | 15,000+ H/s | 完整 JIT |
| Web | 現代瀏覽器 | 40-120 H/s | WASM，無 JIT |

iOS 17.4+ 預設為解譯模式。JIT 作法見 [docs/platforms.md](docs/platforms.md)。

---

## 專案結構

```
xmrig-multi/
├── docs/                   # 編譯、平台、費用說明
├── app/                    # Android
│   └── src/main/jniLibs/   # build_xmrig.sh 產出的 libxmrig.so（gitignore）
├── ios/                    # iOS
├── web/                    # 網頁礦機 + proxy
├── desktop/                # Tauri
├── wearos/ / watchos/      # 伴侶應用
├── xmrig_custom_source/    # 自訂 1% fee 原始碼
└── scripts/                # build_xmrig.sh
```

---

## 建置需求

| 平台 | 需求 |
|------|------|
| Android | Android Studio、NDK 26+、JDK 17 |
| iOS | Xcode 15+、macOS 14+ |
| Desktop | Rust 1.70+、Node.js 20+、Tauri CLI |
| Web | Node.js 20+ |

測試：`./gradlew :app:testDebugUnitTest`。Lint：`./gradlew :app:lintDebug`。貢獻流程見 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## License

GNU GPL v3.0，見 [LICENSE](LICENSE)。XMRig 同樣為 GPLv3。

## 免責聲明

僅供學習與研究。挖礦耗電、發熱，可能傷害裝置。禁止上架 App Store / Google Play。使用風險自負。
