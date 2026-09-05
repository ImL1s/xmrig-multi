# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**XMRig Multi** — Cross-platform Monero (XMR) / Wownero (WOW) / DERO mining application with six targets:
- **Android**: Native Kotlin/Compose app with XMRig 6.21.0 (C++ via NDK)
- **iOS**: SwiftUI native miner (sideload-only, Apple bans mining apps)
- **Web**: Browser-based RandomX.js miner with Vite
- **Desktop**: Tauri 2.0 app for macOS/Windows/Linux
- **WearOS**: Companion app for Android smartwatches
- **watchOS**: Stats viewer for Apple Watch (no mining, Apple ban)

User-facing guides: `docs/` (building, platforms, fee, iOS sideload).

## Developer Fee

All platforms include 1% dev fee:
- **Wallet**: `8AfUwcnoJiRDMXnDGj3zX6bMgfaj9pM1WFGr2pakLm3jSYXVLD5fcDMBzkmk4AeSqWYQTA5aerXJ43W65AT82RMqG6NDBnC`
- **Implementation**: Time-based (99 min user → 1 min dev → repeat)
- **Source Files**: `xmrig_custom_source/donate.h` and `DonateStrategy.cpp`

## Build Commands

### Android
```bash
./gradlew :app:assembleDebug           # Debug APK
./gradlew :app:assembleRelease         # Release APK
./gradlew testDebugUnitTest       # Unit tests
./gradlew lintDebug               # Code analysis
./scripts/build_xmrig.sh          # Rebuild XMRig with custom dev fee
```

### iOS
```bash
# From repo root. Tracked .a is upstream donate; rebuild needs ios-cmake + libuv (docs/ios.md).
./ios/XMRigCore/scripts/build-ios.sh
open ios/XMRigMiner-iOS.xcodeproj
```

### Web Miner
```bash
cd web && npm install             # Install dependencies
cd web && npm run dev             # Dev server (port 5173)
cd web/proxy && node server.js    # WebSocket-to-Stratum proxy
```

### Desktop (Tauri)
```bash
cd desktop && npm install
./scripts/build-xmrig.sh          # Build XMRig with custom dev fee
npm run tauri:dev                 # Development
npm run tauri:build               # Production build
```

### WearOS
```bash
./gradlew :wearos:assembleDebug
```

### watchOS
```bash
cd watchos && open XMRigWatch.xcodeproj
```

## Architecture

### Android - Clean Architecture + MVVM + MVI

```
Presentation (Jetpack Compose)
    ↓
ViewModel (MVI: State, Event, Effect)
    ↓
Repository (DataStore, Flow)
    ↓
Native Layer (JNI → C++ XMRig)
```

**Key architectural decisions:**
- **KSP** over KAPT for 3-4x faster compilation
- **WorkManager** for background mining (not Service)
- **DataStore** for preferences (not SharedPreferences)
- **Kotlin Flow** for reactive streams
- **MVI pattern** for unidirectional data flow

### Directory Structure

```
xmrig-multi/
├── docs/                          # Building, platforms, fee guides
├── app/                           # Android app
│   ├── src/main/java/.../
│   │   ├── data/                  # Models, repositories
│   │   ├── presentation/          # UI screens, ViewModels
│   │   ├── service/               # Workers (mining, monitoring)
│   │   │   └── DevFeePolicy.kt    # 1% fee constants (XMRig applies the fee)
│   │   ├── native/                # JNI bridge
│   │   └── di/                    # Hilt DI modules
│   ├── src/main/cpp/              # C++ native code
│   └── src/main/jniLibs/          # gitignored libxmrig.so after build_xmrig.sh
├── ios/                           # iOS app
│   ├── XMRigMiner-iOS/            # SwiftUI app
│   └── XMRigCore/                 # XMRig C++ build
├── web/                           # Web miner
│   ├── js/                        # JavaScript source
│   └── proxy/                     # WebSocket proxy (with dev fee)
├── desktop/                       # Tauri desktop app
│   └── src-tauri/                 # Rust backend
├── wearos/                        # WearOS companion
├── watchos/                       # watchOS companion
├── xmrig_custom_source/           # Custom XMRig source (dev fee)
│   ├── donate.h                   # 1% fee level
│   └── DonateStrategy.cpp         # Custom wallet address
└── scripts/                       # Build scripts
```

## Key Files for Dev Fee

| File | Purpose |
|------|---------|
| `xmrig_custom_source/donate.h` | Sets `kDefaultDonateLevel = 1` (1%) |
| `xmrig_custom_source/DonateStrategy.cpp` | Custom wallet address |
| `app/.../service/DevFeePolicy.kt` | Shared 1% time-window constants/tests |
| `web/proxy/dev-fee.js` | Web proxy fee window + login rewrite |
| `docs/dev-fee.md` | Fee documentation |

## Dependencies

Dependencies managed via Version Catalog at `gradle/libs.versions.toml`.

Key versions:
- Kotlin 1.9.21, Compose BOM 2024.10.00
- Android SDK 34, NDK 26.3.11579264
- Hilt 2.50, WorkManager 2.10.5

## Testing

- Unit tests: `app/src/test/java/com/iml1s/xmrigminer/`
- E2E tests: `.maestro/` directory (Maestro)
- Uses JUnit 4 + Turbine for Flow testing

## MVI Contract Pattern

Each screen follows this pattern:
```kotlin
object MiningContract {
    data class State(...)      // UI state
    sealed class Event { ... } // User actions
    sealed class Effect { ... } // One-shot effects
}

class MiningViewModel : ViewModel() {
    val state: StateFlow<State>
    fun onEvent(event: Event)
    val effect: SharedFlow<Effect>
}
```

## Development Requirements

| Platform | Requirements |
|----------|--------------|
| Android | Android Studio Hedgehog+, JDK 17, NDK 26+ |
| iOS | Xcode 15+, macOS 14+ |
| Desktop | Rust 1.70+, Node.js 20+, Tauri CLI |
| Web | Node.js 20+ |
| WearOS | Android Studio, Wear OS SDK |
| watchOS | Xcode 15+ |

## CI/CD

GitHub Actions workflows in `.github/workflows/`:
- `android-ci.yml` - Build, test, lint on push/PR
- `web-miner-ci.yml` - Web miner builds
- `release.yml` - Auto-release on version tags
