# Building XMRig

Compile native XMRig with this repo's 1% developer fee (`xmrig_custom_source/`). Binaries are **gitignored**; rebuild them after a clean checkout.

[繁體中文](building.zh-TW.md) · [Developer fee](dev-fee.md) · [iOS](ios.md)

This project does **not** ship pre-built miner binaries and has no mock-binary scripts. Do not use `compile_xmrig.sh` or `create_mock_binaries.sh` — those files do not exist.

## Clone

```bash
git clone https://github.com/ImL1s/xmrig-android.git
cd xmrig-android
```

## Android

Produces the packaged native library (preferred) plus an assets fallback:

- `app/src/main/jniLibs/arm64-v8a/libxmrig.so` (gitignored)
- `app/src/main/assets/xmrig_arm64` (gitignored fallback)

### Prerequisites

- Android NDK r26 or later (`ANDROID_NDK_HOME`)
- CMake 3.22.1 or later
- Git
- Linux or macOS (NDK cross-compile)

Set NDK, for example:

```bash
export ANDROID_NDK_HOME="$HOME/Library/Android/sdk/ndk/26.3.11579264"
```

Or install NDK via Android Studio: Tools → SDK Manager → SDK Tools → NDK (Side by side).

### Build

From the repository root:

```bash
./scripts/build_xmrig.sh
```

The script clones XMRig **v6.21.0**, copies `xmrig_custom_source/donate.h` and `DonateStrategy.cpp`, builds `arm64-v8a`, and copies the binary into `jniLibs` and `assets`.

Expected time: 10–30 minutes. Disk: ~500 MB of build artifacts.

### App APK

```bash
./gradlew :app:assembleDebug
./gradlew :app:installDebug
```

Without `libxmrig.so` (and without the assets fallback) the APK still builds, but mining cannot start.

### Verify on device

```bash
file app/src/main/jniLibs/arm64-v8a/libxmrig.so
# ELF 64-bit LSB pie executable, ARM aarch64

adb logcat | grep -i xmrig
```

### Troubleshooting

| Problem | What to try |
|---------|-------------|
| `ANDROID_NDK_HOME is not set` | Export the NDK path (see above) |
| CMake not found | `brew install cmake` or `sudo apt-get install cmake` |
| Build errors | NDK r26+, CMake 3.22.1+, `rm -rf /tmp/xmrig` and re-run the script |
| Mining never starts | Confirm `libxmrig.so` exists, then reinstall the debug APK |

Do not download random “pre-built XMRig for Android” binaries. Compile with the script above so the fee wallet in `xmrig_custom_source/` is actually in the binary.

## Desktop (macOS / Windows / Linux)

```bash
cd desktop
npm install
./scripts/build-xmrig.sh
npm run tauri:dev
```

Output goes under `desktop/src-tauri/binaries/` (`xmrig` or `xmrig.exe`, gitignored). Production: `npm run tauri:build`.

## iOS

Use [`docs/ios.md`](ios.md): `ios/XMRigCore/scripts/build-ios.sh`.

## WearOS / watchOS companions

Companions do not compile XMRig. Wear: `./gradlew :wearos:assembleDebug`. watchOS: `cd watchos && xcodegen generate`.

## Resources

- [XMRig](https://github.com/xmrig/xmrig)
- [Android NDK](https://developer.android.com/ndk/guides)
- [Custom fee sources](../xmrig_custom_source/README.md)
