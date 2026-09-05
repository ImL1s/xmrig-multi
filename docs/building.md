# Building XMRig

Compile (or rebuild) native XMRig with this repo's 1% developer fee (`xmrig_custom_source/`).

[繁體中文](building.zh-TW.md) · [Developer fee](dev-fee.md) · [iOS](ios.md)

There are no `compile_xmrig.sh` or `create_mock_binaries.sh` scripts. Do not download random third-party XMRig binaries.

A **normal git clone already contains some miner artifacts**:

| Artifact | Role |
|----------|------|
| `app/src/main/assets/xmrig_arm64` | Tracked miner with this repo's 1% fee wallet. Gradle copies it to `jniLibs/.../libxmrig.so` when that gitignored file is missing (Android 10+ cannot execute a copy in `filesDir`) |
| `desktop/src-tauri/binaries/xmrig-x86_64-unknown-linux-gnu` | Linux desktop binary (this repo's fee wallet) |
| `ios/XMRigCore/output/libxmrig-ios-arm64.a` | Linkable iOS archive; **upstream** XMRig 6.25.0 donate, not `8AfU...` |

`app/src/main/jniLibs/arm64-v8a/libxmrig.so` is **not** stored in git. `./scripts/build_xmrig.sh` writes it (preferred). If it is absent, `./gradlew :app:assembleDebug` runs `:app:stageXmrigJniLib`, which packages the tracked asset as **arm64-v8a** `libxmrig.so` so API 29+ **64-bit** devices can start mining. The app `ndk.abiFilters` is **arm64-v8a only**; there is no `armeabi-v7a` miner (`build_xmrig.sh` only builds arm64). Do not treat a runtime copy into `filesDir` as a modern-Android fallback.

## Clone

```bash
git clone https://github.com/ImL1s/xmrig-multi.git
cd xmrig-multi
```

## Android

### App APK (Gradle packages the tracked asset as jniLibs)

```bash
./gradlew :app:assembleDebug
./gradlew :app:installDebug
```

### Rebuild XMRig

Prerequisites: Android NDK r26+ (`ANDROID_NDK_HOME`), CMake 3.22.1+, Git, Linux or macOS.

```bash
export ANDROID_NDK_HOME="$HOME/Library/Android/sdk/ndk/26.3.11579264"
./scripts/build_xmrig.sh
```

The script clones XMRig **v6.21.0**, copies `xmrig_custom_source/donate.h` and `DonateStrategy.cpp`, builds `arm64-v8a`, and overwrites `jniLibs` and `assets`. Expected time: 10–30 minutes.

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
| Mining never starts | Confirm `libxmrig.so` or `xmrig_arm64` is present, then reinstall the debug APK |

## Desktop (macOS / Windows / Linux)

Linux checkouts include `desktop/src-tauri/binaries/xmrig-x86_64-unknown-linux-gnu`. macOS and Windows need a local build (`xmrig` / `xmrig.exe`).

```bash
cd desktop
npm install
./scripts/build-xmrig.sh
npm run tauri:dev
```

Production: `npm run tauri:build`.

## iOS

The tracked `.a` only lets Xcode link; it does **not** contain this repo's fee wallet. Rebuild for `8AfU...`: [ios.md](ios.md).

## WearOS / watchOS companions

Companions do not compile XMRig. Wear: `./gradlew :wearos:assembleDebug`. watchOS: `cd watchos && xcodegen generate`.

## Resources

- [XMRig](https://github.com/xmrig/xmrig)
- [Android NDK](https://developer.android.com/ndk/guides)
- [Custom fee sources](../xmrig_custom_source/README.md)
