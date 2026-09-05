# Building XMRig Miner for iOS

Sideload-only. Apple App Store prohibits cryptocurrency mining apps.

Native RandomX on stock iOS runs in interpreted mode (~3–5 H/s). JIT (~200–400 H/s) needs SideStore + StikDebug on older devices. Details: [platforms.md](platforms.md).

## Requirements

- macOS 14+ (Sonoma)
- Xcode 15+
- Apple Developer Account ($99/year for 1-year signing, or free for 7-day)
- Physical iOS device (arm64) — **Simulator will not mine**

## Tracked archive is not this repo's fee wallet

`ios/XMRigCore/output/libxmrig-ios-arm64.a` is committed so Xcode can link on a clean clone. It is **XMRig 6.25.0 with upstream donate** (`donate.v2.xmrig.com`). The project wallet from `xmrig_custom_source/DonateStrategy.cpp` is **not** in that archive.

Use it only to compile/sideload the Swift UI. Do **not** ship that archive as this project's 1% fee build. Confirm after a real rebuild:

```bash
strings ios/XMRigCore/output/libxmrig-ios-arm64.a | grep 8AfUwcno
```

## Open Xcode (UI / sideload experiments)

From the **repository root** (do not `cd` into `ios/XMRigCore/scripts` first):

```bash
open ios/XMRigMiner-iOS.xcodeproj
```

### Configure signing

1. Select the project in Xcode
2. Go to Signing & Capabilities
3. Select your Team (Apple ID)
4. Change Bundle Identifier if needed

### Build and run

1. Connect your iPhone
2. Select your device in Xcode
3. Press `Cmd + R`

The Start button requires a wallet saved in Settings. The app does not auto-start mining.

## Rebuild XMRig with this repo's 1% fee

`./ios/XMRigCore/scripts/build-ios.sh` downloads XMRig **6.21.0**, copies `xmrig_custom_source/`, and overwrites `libxmrig-ios-arm64.a`. On a typical clone it **exits immediately** unless both files exist:

1. `ios/XMRigCore/libs/ios-cmake/ios.toolchain.cmake` (`ios-cmake` is a gitlink with no `.gitmodules` entry — clone [ios-cmake](https://github.com/leetal/ios-cmake) into that directory)
2. `ios/XMRigCore/libs/libuv-1.48.0/build-ios/libuv.a` — **not tracked**. The libuv tree has leftover CMake cache files under `build-ios/` but **no `libuv.a` and no `build-ios.sh`**. There is no in-repo command that produces that archive; you must build libuv for iOS yourself and place `libuv.a` at that path. A typical clone therefore **cannot** rebuild XMRig.

Then, still from the **repository root**:

```bash
./ios/XMRigCore/scripts/build-ios.sh
open ios/XMRigMiner-iOS.xcodeproj
```

Do not hand-edit donate headers; the script copies this repo's files.

## Sideloading (without a long-lived Xcode install)

### AltStore / SideStore

1. Install [AltStore](https://altstore.io/) or [SideStore](https://sidestore.io)
2. Archive an IPA from Xcode
3. Install the IPA on device

| Account Type | Signing Validity |
|--------------|------------------|
| Free Apple ID | 7 days |
| $99 Developer | 1 year |

## Troubleshooting

**"No such module 'XMRigCore'"**

- Confirm `ios/XMRigCore/output/libxmrig-ios-arm64.a` is present
- Check library search paths in Xcode

**"Signing certificate not found"**

- Add your Apple ID in Xcode Settings → Accounts

**Fee window does not use `8AfU...`**

- The tracked archive still uses XMRig's donation host. Rebuild as above, then re-check `strings`.

**Low or zero hashrate**

- Physical arm64 device only
- JIT blocked on iOS 17.4+ unless you use SideStore + StikDebug (see [platforms.md](platforms.md))
- Thermal throttling

Customization notes (fee vs user wallet): [ios/CUSTOMIZATION.md](../ios/CUSTOMIZATION.md).
