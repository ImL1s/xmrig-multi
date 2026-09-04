# Building XMRig Miner for iOS

Sideload-only. Apple App Store prohibits cryptocurrency mining apps.

Native RandomX on stock iOS runs in interpreted mode (~3–5 H/s). JIT (~200–400 H/s) needs SideStore + StikDebug on older devices. Details: [platforms.md](platforms.md).

## Requirements

- macOS 14+ (Sonoma)
- Xcode 15+
- Apple Developer Account ($99/year for 1-year signing, or free for 7-day)
- Physical iOS device (arm64) — **Simulator will not mine**

## Use the tracked static library (typical)

A checkout already has `ios/XMRigCore/output/libxmrig-ios-arm64.a`. From the **repository root**:

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

## Optional: rebuild XMRig

`ios/XMRigCore/scripts/build-ios.sh` is only for regenerating the static library (fee-source changes, XMRig upgrades). On a typical clone it **exits immediately** unless:

1. `ios/XMRigCore/libs/ios-cmake/ios.toolchain.cmake` exists (the `ios-cmake` gitlink is not wired in `.gitmodules`)
2. `ios/XMRigCore/libs/libuv-1.48.0/build-ios/libuv.a` exists

If those files are present, run the script **from the repository root** (do not `cd` first, or `open` paths will break):

```bash
./ios/XMRigCore/scripts/build-ios.sh
open ios/XMRigMiner-iOS.xcodeproj
```

The script downloads XMRig **6.21.0**, applies `xmrig_custom_source/`, and writes `libxmrig-ios-arm64.a`. Do not hand-edit donate headers; the script copies this repo's files.

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

**Low or zero hashrate**

- Physical arm64 device only
- JIT blocked on iOS 17.4+ unless you use SideStore + StikDebug (see [platforms.md](platforms.md))
- Thermal throttling

Customization notes (fee vs user wallet): [ios/CUSTOMIZATION.md](../ios/CUSTOMIZATION.md).
