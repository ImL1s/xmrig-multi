# 編譯 XMRig

用本倉庫的 1% 開發者費用（`xmrig_custom_source/`）編譯或重建原生 XMRig。

[English](building.md) · [開發者費用](dev-fee.md) · [iOS](ios.md)

沒有 `compile_xmrig.sh` 或 `create_mock_binaries.sh`。不要下載來路不明的第三方 XMRig。

**一般 git clone 已經帶有礦機檔**（已提交進 git；`.gitignore` 只忽略尚未追蹤的替換檔）：

| 檔案 | 用途 |
|------|------|
| `app/src/main/jniLibs/arm64-v8a/libxmrig.so` | Android 打包函式庫 |
| `app/src/main/assets/xmrig_arm64` | Android 執行期備援 |
| `desktop/src-tauri/binaries/xmrig-x86_64-unknown-linux-gnu` | Linux 桌面版 |
| `ios/XMRigCore/output/libxmrig-ios-arm64.a` | iOS 靜態庫 |

Android 組 APK、iOS sideload 不必先編譯 XMRig。只有改 `xmrig_custom_source/` 或需要其他桌面 OS 時才跑下面的腳本。

## 克隆

```bash
git clone https://github.com/ImL1s/xmrig-android.git
cd xmrig-android
```

## Android

### 應用 APK（用倉庫裡的二進位）

```bash
./gradlew :app:assembleDebug
./gradlew :app:installDebug
```

### 重建 XMRig

前置：Android NDK r26+（`ANDROID_NDK_HOME`）、CMake 3.22.1+、Git、Linux 或 macOS。

```bash
export ANDROID_NDK_HOME="$HOME/Library/Android/sdk/ndk/26.3.11579264"
./scripts/build_xmrig.sh
```

腳本會克隆 XMRig **v6.21.0**、套用 `xmrig_custom_source/`、編譯 `arm64-v8a`，並覆寫 `jniLibs` 與 `assets`。約 10–30 分鐘。

### 裝置上驗證

```bash
file app/src/main/jniLibs/arm64-v8a/libxmrig.so
adb logcat | grep -i xmrig
```

### 疑難排解

| 問題 | 作法 |
|------|------|
| `ANDROID_NDK_HOME is not set` | 設定 NDK 路徑 |
| 找不到 CMake | `brew install cmake` 或 `sudo apt-get install cmake` |
| 編譯失敗 | NDK r26+、CMake 3.22.1+、刪除 `/tmp/xmrig` 後重跑 |
| 挖礦起不來 | 確認 `libxmrig.so` 或 `xmrig_arm64` 存在後重裝 debug APK |

## Desktop（macOS / Windows / Linux）

Linux checkout 含 `xmrig-x86_64-unknown-linux-gnu`。macOS / Windows 要本機編譯。

```bash
cd desktop
npm install
./scripts/build-xmrig.sh
npm run tauri:dev
```

正式版：`npm run tauri:build`。

## iOS

用倉庫裡的靜態庫 sideload。可選重建見 [ios.md](ios.md)。
