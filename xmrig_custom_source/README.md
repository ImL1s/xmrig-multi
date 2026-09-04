# Custom XMRig Source Files

這些是已經修改過的 XMRig 源碼檔案，配置了自定義的開發者費用機制（1%）。

## 開發者費用

- **費用比例**: 1%
- **錢包地址**: `8AfUwcnoJiRDMXnDGj3zX6bMgfaj9pM1WFGr2pakLm3jSYXVLD5fcDMBzkmk4AeSqWYQTA5aerXJ43W65AT82RMqG6NDBnC`
- **機制**: 時間分配制（99分鐘用戶 → 1分鐘開發者 → 循環）

## 修改內容

### 1. src/donate.h

設置開發者費用級別：

```cpp
constexpr const int kDefaultDonateLevel = 1;  // 1% 開發者費用
constexpr const int kMinimumDonateLevel = 0;  // 允許用戶選擇 0%
```

### 2. src/net/strategies/DonateStrategy.cpp

設置開發者錢包地址和礦池：

```cpp
// 開發者錢包地址
const char *donateWallet = "8AfUwcnoJiRDMXnDGj3zX6bMgfaj9pM1WFGr2pakLm3jSYXVLD5fcDMBzkmk4AeSqWYQTA5aerXJ43W65AT82RMqG6NDBnC";

// 礦池
static const char *kDonateHost = "pool.supportxmr.com";  // 普通連接 port 3333
static const char *kDonateHostTls = "pool.supportxmr.com";  // TLS 連接 port 5555
```

## 如何使用

編譯腳本會自動套用這些自訂檔案：

```bash
# Android
./scripts/build_xmrig.sh

# iOS
cd ios/XMRigCore/scripts && ./build-ios.sh

# Desktop (macOS/Windows/Linux)
cd desktop/scripts && ./build-xmrig.sh
```

## 手動套用

如果需要手動套用：

1. 下載 XMRig 6.21.0 源碼：
   ```bash
   git clone https://github.com/xmrig/xmrig.git
   cd xmrig
   git checkout v6.21.0
   ```

2. 替換修改過的檔案：
   ```bash
   cp /path/to/xmrig_custom_source/donate.h src/
   cp /path/to/xmrig_custom_source/DonateStrategy.cpp src/net/strategies/
   ```

3. 按照各平台的說明編譯 XMRig

## 編譯注意事項

### Android
- 需要 Android NDK 26+
- 需要先編譯 libuv for Android
- 建議禁用 TLS (`-DWITH_TLS=OFF`) 如果遇到問題

### iOS
- 需要 ios-cmake toolchain
- 需要先編譯 libuv for iOS
- 使用 `-fembed-bitcode` 編譯

### Desktop
- 需要 CMake 3.10+
- macOS/Linux 需要 OpenSSL
- Windows 需要 Visual Studio

## 驗證

編譯完成後，可以用以下命令驗證錢包地址：

```bash
strings xmrig | grep "8AfUwcnoJiRDMXnDGj3zX6bMgfaj9pM1WFGr2pakLm3jSYXVLD5fcDMBzkmk4AeSqWYQTA5aerXJ43W65AT82RMqG6NDBnC"
```

詳細編譯步驟請參考 [docs/building.md](../docs/building.md) 與 [docs/ios.md](../docs/ios.md)。
