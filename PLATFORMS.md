# XMRig Miner - Multi-Platform Support

Cross-platform Monero/Wownero/DERO mining application.

## Supported Platforms

| Platform | Type | Status | Mining | Notes |
|----------|------|--------|--------|-------|
| **Android** | Mobile | ⚠️ Binary required | ✅ Native XMRig | `scripts/build_xmrig.sh` then `:app:assembleDebug` |
| **iOS** | Mobile | ✅ Sideload | ⚠️ Limited | JIT blocked (3-5 H/s), see below |
| **Web** | Browser | ✅ Demo | ✅ RandomX.js | WebSocket proxy required |
| **macOS** | Desktop | ⚠️ Binary required | ✅ Native XMRig | `desktop/scripts/build-xmrig.sh` |
| **Windows** | Desktop | ⚠️ Binary required | ✅ Native XMRig | `desktop/scripts/build-xmrig.sh` |
| **Linux** | Desktop | ⚠️ Binary required | ✅ Native XMRig | `desktop/scripts/build-xmrig.sh` |
| **WearOS** | Watch | Companion | ❌ No | `./gradlew :wearos:assembleDebug` |
| **watchOS** | Watch | Companion | ❌ No | `cd watchos && xcodegen generate` |

---

## Desktop Application (macOS/Windows/Linux)

Built with **Tauri 2.0** for native performance with minimal bundle size.

### Features
- Native XMRig integration
- Real-time hashrate monitoring
- Multi-coin support (XMR, WOW, DERO)
- Auto-update capability
- System tray support

### Build

```bash
cd desktop

# Install dependencies
npm install

# Download XMRig binary for your platform
./scripts/build-xmrig.sh

# Development
npm run tauri:dev

# Production build
npm run tauri:build
```

### Output
- **macOS**: `target/release/bundle/dmg/XMRig Miner.dmg`
- **Windows**: `target/release/bundle/nsis/XMRig Miner Setup.exe`
- **Linux**: `target/release/bundle/appimage/XMRig Miner.AppImage`

---

## WearOS Companion App

Companion app for Android smartwatches running Wear OS 3.0+.

### Features
- View mining stats from phone
- Start/Stop mining remotely
- Tile for quick stats view
- Complications for watch faces

### Build

```bash
# from repo root
./gradlew :wearos:assembleDebug
```

### Requirements
- Wear OS 3.0+ (API 30+)
- Main XMRig Miner app installed on phone
- Phone and watch paired

---

## watchOS Stats Viewer

Stats viewer for Apple Watch. **Note: Apple prohibits mining apps.**

> ⚠️ **Apple App Store Guidelines 2.4.2**: "Apps, including any third-party advertisements displayed within them, may not run unrelated background processes, such as cryptocurrency mining."

### Features
- View hashrate and stats
- Control mining on connected iPhone/Mac
- Watch face complications
- Quick glance at mining status

### Build

```bash
cd watchos

# Open in Xcode
open XMRigWatch.xcodeproj

# Build for simulator or device
```

### Requirements
- watchOS 9.0+
- iPhone with iOS companion app
- WatchConnectivity framework

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Mining Backend                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   XMRig     │  │ RandomX.js  │  │  XMRig      │              │
│  │  (Native)   │  │  (WASM)     │  │ (Embedded)  │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│        ↑                ↑                ↑                       │
│  Desktop/Android      Web            iOS                         │
└─────────────────────────────────────────────────────────────────┘
                              ↑
                    Communication Layer
                              ↑
┌─────────────────────────────────────────────────────────────────┐
│                     Companion Apps                               │
│  ┌─────────────┐              ┌─────────────┐                   │
│  │   WearOS    │◄────────────►│   watchOS   │                   │
│  │  (Android)  │   Wearable   │   (Apple)   │                   │
│  │             │   Data API   │             │                   │
│  └─────────────┘              └─────────────┘                   │
│        ↑                            ↑                            │
│   Phone Mining                iPhone/Mac                         │
│    Control                     Control                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Performance Comparison

| Platform | Expected Hashrate | Power Usage | Notes |
|----------|-------------------|-------------|-------|
| Desktop (AMD Ryzen 9) | 15,000+ H/s | High | Best performance |
| Desktop (Apple M2) | 2,500+ H/s | Medium | Efficient |
| Android (SD 8 Gen 2) | 800-1,200 H/s | Medium | Thermal throttling |
| Web (Chrome) | 100-200 H/s | Low | JavaScript limitations |
| iOS (no JIT) | 3-5 H/s | Low | Interpreted mode |
| iOS (JIT enabled) | 200-400 H/s | Medium | Requires SideStore+StikDebug |
| WearOS | N/A | - | Companion only |
| watchOS | N/A | - | Companion only |

---

## iOS JIT Restrictions

### The Problem

Apple blocks JIT (Just-In-Time) compilation on iOS for security reasons. RandomX algorithm heavily relies on JIT for performance:

| Mode | Hashrate | Description |
|------|----------|-------------|
| JIT (compiled) | 200-400 H/s | Native machine code execution |
| Interpreted | 3-5 H/s | ~50-100x slower |

### iOS Versions

- **iOS 17.3 and earlier**: JIT possible via Xcode debug mode
- **iOS 17.4+**: Apple completely blocked JIT, even in debug mode
- **iOS 18+**: Same restrictions apply

### Solutions

#### Option 1: Accept Low Performance
Just use the app as-is with ~3-5 H/s. Mining will work, just very slowly.

#### Option 2: SideStore + StikDebug (Recommended)
For non-TXM devices (iPhone 11 and older, 4+ years old):

1. Install [SideStore](https://sidestore.io) via [iLoader](https://github.com/nab138/iloader)
2. Install [StikDebug](https://github.com/StephenDev0/StikDebug) from SideStore
3. Enable JIT for XMRigMiner in StikDebug
4. Launch XMRigMiner - JIT will be enabled

> **Note**: TXM (Trusted Execution Monitor) devices (iPhone 12/A14 and newer) cannot use this method.

### Why Native XMRig Still Matters

Even with low hashrate, native XMRig provides:
- Real mining functionality (accepted shares confirmed)
- Proper pool communication
- Accurate statistics
- Foundation for future improvements

---

## Development

### Prerequisites

- **Desktop**: Rust 1.70+, Node.js 20+, Tauri CLI
- **Android**: Android Studio, NDK 26+
- **iOS**: Xcode 15+, macOS 14+
- **WearOS**: Android Studio, Wear OS emulator
- **watchOS**: Xcode 15+, watchOS Simulator

### Quick Start

```bash
# Clone repository
git clone https://github.com/iml1s/xmrig-android.git
cd xmrig-android

# Desktop
cd desktop && npm install && npm run tauri:dev

# Android
./gradlew assembleDebug

# iOS
cd ios && open XMRigMiner-iOS.xcodeproj

# WearOS
cd wearos && ./gradlew assembleDebug

# watchOS
cd watchos && open XMRigWatch.xcodeproj

# Web
cd web && npm install && npm run dev
```

---

## Developer Fee

All platforms include a **1% developer fee** to support ongoing development.

| Platform | Fee Implementation | Wallet |
|----------|-------------------|--------|
| Android | XMRig donate-level | ✅ |
| iOS | XMRig built-in | ✅ |
| Desktop | XMRig built-in | ✅ |
| Web | Proxy server (server.js) | ✅ |

**Developer Wallet:**
```
8AfUwcnoJiRDMXnDGj3zX6bMgfaj9pM1WFGr2pakLm3jSYXVLD5fcDMBzkmk4AeSqWYQTA5aerXJ43W65AT82RMqG6NDBnC
```

See [DEV_FEE.md](DEV_FEE.md) for detailed explanation.

---

## Building XMRig with Custom Dev Fee

All build scripts automatically apply custom dev fee configuration from `xmrig_custom_source/`:

```bash
# Android
./scripts/build_xmrig.sh

# iOS
cd ios/XMRigCore/scripts && ./build-ios.sh

# Desktop
cd desktop/scripts && ./build-xmrig.sh
```

---

## License

GPLv3 License - See LICENSE file for details.

XMRig is licensed under GPLv3.
