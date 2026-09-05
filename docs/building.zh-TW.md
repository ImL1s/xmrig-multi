# 編譯 XMRig

用本倉庫的 1% 開發者費用（`xmrig_custom_source/`）編譯或重建原生 XMRig。

[English](building.md) · [開發者費用](dev-fee.md) · [iOS](ios.md)

沒有 `compile_xmrig.sh` 或 `create_mock_binaries.sh`。不要下載來路不明的第三方 XMRig。

**一般 git clone 已經帶有部分礦機檔**：

| 檔案 | 用途 |
|------|------|
| `app/src/main/assets/xmrig_arm64` | 含本倉庫 1% 費用錢包。沒有 gitignore 的 `.so` 時，Gradle 會把它打進 `jniLibs/.../libxmrig.so`（Android 10+ 不能執行 `filesDir` 裡的複本） |
| `desktop/src-tauri/binaries/xmrig-x86_64-unknown-linux-gnu` | Linux 桌面版（本倉庫費用錢包） |
| `ios/XMRigCore/output/libxmrig-ios-arm64.a` | 可連結的 iOS archive；**上游** XMRig 6.25.0 donate，不是 `8AfU...` |

`jniLibs/.../libxmrig.so` **不在 git 裡**。`./scripts/build_xmrig.sh` 會寫入它。若沒有，`./gradlew :app:assembleDebug` 會跑 `:app:stageXmrigJniLib`，把 tracked asset 打成 **arm64-v8a** `libxmrig.so`，API 29+ 的 **64 位元**裝置才能挖礦。app 的 `ndk.abiFilters` **只有 arm64-v8a**；checkout 沒有 `armeabi-v7a` 礦機（`build_xmrig.sh` 也只編 arm64）。不要把複製到 `filesDir` 當成現代 Android 的備援。

## 克隆

```bash
git clone https://github.com/ImL1s/xmrig-android.git
cd xmrig-android
```

## Android

### 應用 APK（Gradle 把 tracked asset 打成 jniLibs）

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

倉庫裡的 `.a` 只夠 Xcode 連結，**不含**本倉庫費用錢包。要 `8AfU...` 必須重建：見 [ios.md](ios.md)。
