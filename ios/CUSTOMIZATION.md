# iOS XMRigMiner Customization Record

## 1. Developer fee (1%)

Fee mining is redirected to the app developer wallet during XMRig donate windows:

- **Wallet**: `8AfUwcnoJiRDMXnDGj3zX6bMgfaj9pM1WFGr2pakLm3jSYXVLD5fcDMBzkmk4AeSqWYQTA5aerXJ43W65AT82RMqG6NDBnC`
- **Source**: `xmrig_custom_source/DonateStrategy.cpp` (copied in at build time)

This is the 1% developer fee, **not** the user's wallet. User mining uses the address saved in Settings.

## 2. User configuration

- Wallet, pool, and threads are stored in `UserDefaults` via `MiningConfigStore`.
- The Start button refuses to mine until a wallet is saved.
- The app does not auto-start mining.

## 3. Build

- Static library: tracked `ios/XMRigCore/output/libxmrig-ios-arm64.a` (optional rebuild: `./ios/XMRigCore/scripts/build-ios.sh` — see [docs/ios.md](../docs/ios.md))
- Sideload only — Apple prohibits mining apps on the App Store
- Full steps: [docs/ios.md](../docs/ios.md)
