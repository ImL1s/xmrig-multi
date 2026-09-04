# 編譯 XMRig

用本倉庫的 1% 開發者費用（`xmrig_custom_source/`）編譯原生 XMRig。二進位**已 gitignore**；乾淨 checkout 後必須自己重編。

[English](building.md) · [開發者費用](dev-fee.md) · [iOS](ios.md)

本專案**不提供**預編譯礦機，也沒有 mock 二進位腳本。不要執行 `compile_xmrig.sh` 或 `create_mock_binaries.sh`——這兩個檔案不存在。

## 克隆

```bash
git clone https://github.com/ImL1s/xmrig-android.git
cd xmrig-android
```

## Android

產出打包用原生函式庫（優先）以及 assets 備援：

- `app/src/main/jniLibs/arm64-v8a/libxmrig.so`（gitignore）
- `app/src/main/assets/xmrig_arm64`（gitignore 備援）

### 前置條件

- Android NDK r26 或更新（`ANDROID_NDK_HOME`）
- CMake 3.22.1 或更新
- Git
- Linux 或 macOS（NDK 交叉編譯）

例如：

```bash
export ANDROID_NDK_HOME="$HOME/Library/Android/sdk/ndk/26.3.11579264"
```

或用 Android Studio：Tools → SDK Manager → SDK Tools → NDK (Side by side)。

### 編譯

在倉庫根目錄：

```bash
./scripts/build_xmrig.sh
```

腳本會克隆 XMRig **v6.21.0**、套用 `xmrig_custom_source/donate.h` 與 `DonateStrategy.cpp`、編譯 `arm64-v8a`，再複製到 `jniLibs` 與 `assets`。

預期時間 10–30 分鐘。磁碟約 500 MB 建置產物。

### 應用 APK

```bash
./gradlew :app:assembleDebug
./gradlew :app:installDebug
```

沒有 `libxmrig.so`（也沒有 assets 備援）時 APK 仍能編過，但無法開始挖礦。

### 裝置上驗證

```bash
file app/src/main/jniLibs/arm64-v8a/libxmrig.so
# ELF 64-bit LSB pie executable, ARM aarch64

adb logcat | grep -i xmrig
```

### 疑難排解

| 問題 | 作法 |
|------|------|
| `ANDROID_NDK_HOME is not set` | 設定 NDK 路徑（見上） |
| 找不到 CMake | `brew install cmake` 或 `sudo apt-get install cmake` |
| 編譯失敗 | NDK r26+、CMake 3.22.1+、刪除 `/tmp/xmrig` 後重跑腳本 |
| 挖礦起不來 | 確認 `libxmrig.so` 存在後重裝 debug APK |

不要下載來路不明的「Android 預編譯 XMRig」。用上面的腳本編譯，`xmrig_custom_source/` 裡的費用錢包才會進二進位。

## Desktop（macOS / Windows / Linux）

```bash
cd desktop
npm install
./scripts/build-xmrig.sh
npm run tauri:dev
```

產出在 `desktop/src-tauri/binaries/`（`xmrig` 或 `xmrig.exe`，gitignore）。正式版：`npm run tauri:build`。

## iOS

見 [`docs/ios.md`](ios.md)：`ios/XMRigCore/scripts/build-ios.sh`。

## WearOS / watchOS 伴侶應用

伴侶應用不編譯 XMRig。Wear：`./gradlew :wearos:assembleDebug`。watchOS：`cd watchos && xcodegen generate`。
