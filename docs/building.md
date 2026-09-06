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

Prerequisites: Android NDK r26c (`ANDROID_NDK_HOME`), CMake 3.22.1+, Git, curl, Python 3, Linux or macOS. App `minSdk` is **24** (libuv / getifaddrs).

```bash
export ANDROID_NDK_HOME="$HOME/Library/Android/sdk/ndk/26.3.11579264"
./scripts/build_xmrig.sh
./scripts/native/smoke-native.sh
```

The script (#134) sources `scripts/native/versions.env`, builds pinned OpenSSL+libuv in an isolated `mktemp` work dir (`KEEP_XMRIG_WORK=1` to keep), clones XMRig **v6.21.0**, applies `xmrig_custom_source/` fee patches, and configures `WITH_HTTP=ON` `WITH_TLS=ON` `WITH_BENCHMARK=ON` `WITH_HWLOC=OFF`. It writes `jniLibs`, `assets/xmrig_arm64`, and `assets/native-capabilities.json`. Pool TLS uses **fingerprint** trust (not full CA/hostname). Expected time: 10–30 minutes.

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
| Build errors | NDK r26c, CMake 3.22.1+, unset `KEEP_XMRIG_WORK` and re-run (script uses a fresh mktemp dir) |
| Mining never starts | Confirm `libxmrig.so` or `xmrig_arm64` + `native-capabilities.json` hash match, then reinstall the debug APK |

## Desktop (macOS / Windows / Linux)

Linux checkouts include `desktop/src-tauri/binaries/xmrig-x86_64-unknown-linux-gnu`. macOS and Windows need a local build (`xmrig` / `xmrig.exe`), or use CI artifacts from a `v*` GitHub Release ([v2.3.0](https://github.com/ImL1s/xmrig-multi/releases/tag/v2.3.0)).

`desktop/scripts/build-xmrig.sh` clones XMRig **v6.24.0** (not the Android script’s 6.21.0), applies the same `xmrig_custom_source/` fee patches, and writes Tauri sidecar names under `desktop/src-tauri/binaries/`.

```bash
cd desktop
npm install
./scripts/build-xmrig.sh
npm run tauri:dev
```

Production: `npm run tauri:build`. Tag releases also produce `.deb` / NSIS / DMG via `.github/workflows/release.yml`.

## iOS

The tracked `.a` only lets Xcode link; it does **not** contain this repo's fee wallet. Rebuild for `8AfU...`: [ios.md](ios.md).

## WearOS / watchOS companions

Companions do not compile XMRig. Wear: `./gradlew :wearos:assembleDebug`. watchOS: `cd watchos && xcodegen generate`.

## Resources

- [XMRig](https://github.com/xmrig/xmrig)
- [Android NDK](https://developer.android.com/ndk/guides)
- [Custom fee sources](../xmrig_custom_source/README.md)
