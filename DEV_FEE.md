# Developer Fee 說明

本應用程式包含 **1% 開發者費用**，用於支持持續開發與維護。

## 費用機制

開發者費用採用**時間分配制**，而非從您的收益中扣除：

```
┌─────────────────────────────────────────────────────────────┐
│  您的錢包挖礦: 99分鐘  →  開發者錢包挖礦: 1分鐘  →  循環...  │
└─────────────────────────────────────────────────────────────┘
```

### 運作方式

1. **99% 時間**：挖礦收益進入**您的錢包**
2. **1% 時間**：挖礦收益進入**開發者錢包**
3. 每 100 分鐘為一個完整週期

### 開發者錢包地址

```
8AfUwcnoJiRDMXnDGj3zX6bMgfaj9pM1WFGr2pakLm3jSYXVLD5fcDMBzkmk4AeSqWYQTA5aerXJ43W65AT82RMqG6NDBnC
```

## 各平台實現

原生平台只走 **XMRig 編譯期 donate**（`donate-level = 1` + 自訂 `DonateStrategy.cpp`）。Web 無法嵌入 XMRig，所以在 proxy 用同一套時間窗口改寫 Stratum login。

| 平台 | 實現方式 | 說明 |
|------|----------|------|
| **Android / iOS / Desktop** | XMRig `--donate-level=1` | 編譯時寫入開發者錢包 |
| **Web** | `web/proxy/dev-fee.js` | 99 分鐘使用者 / 1 分鐘開發者，切換時重新 login |

Kotlin `DevFeePolicy` 與 JS `dev-fee.js` 共用同一組數字，方便測試，**不會**再平行跑一套 Kotlin 錢包切換。

## 技術細節

### XMRig C++ 層 (Android/iOS/Desktop)

**donate.h**

```cpp
constexpr const int kDefaultDonateLevel = 1;  // 1%
constexpr const int kMinimumDonateLevel = 0;
```

**DonateStrategy.cpp**

```cpp
const char *donateWallet = "8AfUwcnoJiRDMXnDGj3zX6bMgfaj9pM1WFGr2pakLm3jSYXVLD5fcDMBzkmk4AeSqWYQTA5aerXJ43W65AT82RMqG6NDBnC";
```

首次啟動時錢包欄位是空的，必須由使用者填入自己的地址，應用程式不會默認用開發者錢包挖礦。

## 常見問題

### Q: 費用會從我已挖到的幣中扣除嗎？
**A:** 不會。費用是透過時間分配實現的，不會動到您已挖到的幣。

### Q: 我可以關閉開發者費用嗎？
**A:** 技術上可以自行編譯移除，但這會違反使用條款。1% 的費用用於支持應用程式的持續開發與維護。

### Q: 費用會影響我的算力嗎？
**A:** 不會影響您的算力表現。只是在切換期間，收益會暫時進入開發者錢包。

## 重新編譯

```bash
# Android（產出 jniLibs/arm64-v8a/libxmrig.so，檔案 gitignore）
./scripts/build_xmrig.sh

# iOS
cd ios/XMRigCore/scripts && ./build-ios.sh

# Desktop
cd desktop/scripts && ./build-xmrig.sh
```

編譯腳本會自動套用 `xmrig_custom_source/` 中的自訂設定。
