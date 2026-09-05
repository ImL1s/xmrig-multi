# AGENTS.md - Development Guidelines for XMRig Multi

This document provides comprehensive development guidelines for the XMRig Multi cross-platform mining application. Follow these guidelines to maintain code quality, consistency, and architectural integrity across Android, iOS, Web, Desktop, WearOS, and watchOS platforms.

Human-facing build and platform notes live in [docs/README.md](docs/README.md).

## Build Commands

### Android
```bash
# Debug APK build
./gradlew :app:assembleDebug

# Release APK build
./gradlew :app:assembleRelease

# Unit tests
./gradlew testDebugUnitTest

# Lint code analysis
./gradlew lintDebug

# Clean build
./gradlew clean

# Run single test class
./gradlew testDebugUnitTest --tests "*MiningConfigTest*"

# Run single test method
./gradlew testDebugUnitTest --tests "*MiningConfigTest*isValid*"
```

### iOS
```bash
# From the repository root. Needs ios-cmake + libuv.a; see docs/ios.md.
# Tracked libxmrig-ios-arm64.a is upstream donate, not this repo's fee wallet.
./ios/XMRigCore/scripts/build-ios.sh
open ios/XMRigMiner-iOS.xcodeproj
```

### Web Miner
```bash
# Install dependencies
cd web && npm install

# Development server (port 5173)
cd web && npm run dev

# Build production
cd web && npm run build

# Preview production build
cd web && npm run preview

# WebSocket proxy for mining
cd web/proxy && node server.js
```

### Desktop (Tauri)
```bash
# Install dependencies
cd desktop && npm install

# Development
npm run tauri:dev

# Production build
npm run tauri:build
```

### WearOS
```bash
# Build debug APK
./gradlew :wearos:assembleDebug
```

### watchOS
```bash
# Open Xcode project
cd watchos && open XMRigWatch.xcodeproj
```

## Test Commands

### Android Unit Tests
```bash
# All unit tests
./gradlew testDebugUnitTest

# Single test class
./gradlew testDebugUnitTest --tests "*MiningConfigTest*"

# Test method pattern
./gradlew testDebugUnitTest --tests "*MiningConfigTest*isValid*"

# With coverage
./gradlew testDebugUnitTest jacocoTestReport
```

### Android Instrumentation Tests
```bash
# Connected device tests
./gradlew connectedAndroidTest

# Specific device
./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.iml1s.xmrigminer.ExampleInstrumentedTest
```

## Code Style Guidelines

### Kotlin (Android)

#### Architecture Patterns
- **MVI Pattern**: Use sealed interfaces for `State`, `Event`, and `Effect`
- **Clean Architecture**: Separate data/presentation/service layers
- **Repository Pattern**: Abstract data sources behind repository interfaces
- **Dependency Injection**: Use Hilt for all dependencies

#### Naming Conventions
- Classes: `PascalCase` (e.g., `MiningConfig`, `ConfigViewModel`)
- Functions/Methods: `camelCase` (e.g., `isValid()`, `startMining()`)
- Variables/Properties: `camelCase` (e.g., `walletAddress`, `poolUrl`)
- Constants: `SCREAMING_SNAKE_CASE` (e.g., `DEFAULT_POOL_URL`)
- Test Methods: Backtick enclosed descriptive names (e.g., `\`isValid returns true for valid config\``)

#### Code Structure
```kotlin
// Data class with defaults
data class MiningConfig(
    val poolUrl: String = "pool.supportxmr.com:3333",
    val walletAddress: String = "",
    val threads: Int = Runtime.getRuntime().availableProcessors() - 1
)

// MVI Contract
sealed interface ConfigUiState {
    data object Loading : ConfigUiState
    data class Success(val config: MiningConfig) : ConfigUiState
    data class Error(val message: String) : ConfigUiState
}

sealed interface ConfigUiEvent {
    data class PoolSelected(val pool: Pool) : ConfigUiEvent
    data object SaveConfig : ConfigUiEvent
}

// ViewModel
class ConfigViewModel @Inject constructor(
    private val repository: ConfigRepository
) : ViewModel() {
    val state: StateFlow<ConfigUiState> = // ...
    
    fun onEvent(event: ConfigUiEvent) {
        // Handle events
    }
}
```

#### Imports Organization
- AndroidX imports first
- Third-party libraries (Hilt, Compose, etc.)
- Standard library imports
- Group related imports together

#### Error Handling
- Use `Result<T>` for synchronous operations
- Use `Flow<T>` with error states for async operations
- Validate input at domain boundaries
- Provide meaningful error messages to users

### JavaScript (Web)

#### Architecture Patterns
- ES6 modules with clear import/export structure
- Class-based components with single responsibility
- Event-driven architecture for UI interactions
- Separation of concerns (UI logic, mining logic, validation)

#### Naming Conventions
- Classes: `PascalCase` (e.g., `App`, `Miner`)
- Methods: `camelCase` (e.g., `startMining()`, `validateAddress()`)
- Variables: `camelCase` (e.g., `walletAddress`, `miningStats`)
- Constants: `SCREAMING_SNAKE_CASE` (e.g., `DEFAULT_POOL_URL`)
- DOM elements: Prefixed with `dom` (e.g., `dom.startBtn`)

#### Code Structure
```javascript
// Class-based architecture
class App {
    constructor() {
        this.miner = new Miner();
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadSettings();
    }

    bindEvents() {
        this.dom.startBtn.addEventListener('click', () => this.startMining());
    }

    startMining() {
        const config = {
            walletAddress: this.dom.walletAddress.value,
            threads: parseInt(this.dom.threads.value)
        };
        this.miner.start(config);
    }
}
```

#### Documentation
- Use JSDoc for public methods
- Document complex algorithms and configurations
- Include parameter and return type descriptions

### Swift (iOS)

#### Architecture Patterns
- SwiftUI with declarative view composition
- Environment objects for shared state
- Protocol-oriented programming
- MVVM with observable objects

#### Naming Conventions
- Types: `PascalCase` (e.g., `ContentView`, `MiningConfig`)
- Functions/Methods: `camelCase` (e.g., `startMining()`, `formatHashrate()`)
- Variables/Properties: `camelCase` (e.g., `isRunning`, `hashrate`)
- Constants: `camelCase` or `lowerCamelCase`

#### Code Structure
```swift
// View with environment object
struct ContentView: View {
    @EnvironmentObject var miner: XMRigWrapper
    
    var body: some View {
        VStack {
            if miner.isRunning {
                Text("Mining active")
            } else {
                Text("Miner stopped")
            }
        }
    }
}

// Observable object
class XMRigWrapper: ObservableObject {
    @Published var isRunning = false
    @Published var stats = MiningStats()
    
    func start() {
        // Implementation
        isRunning = true
    }
}
```

#### View Organization
- Use `MARK:` comments to organize view sections
- Group related views together
- Provide preview providers for development
- Use descriptive view names

### Rust (Desktop)

#### Architecture Patterns
- Tauri command pattern for frontend communication
- Mutex-protected shared state
- Error handling with `Result<T, E>`
- Separation of concerns between UI and business logic

#### Naming Conventions
- Functions: `snake_case` (e.g., `start_mining()`, `get_stats()`)
- Types/Structs: `PascalCase` (e.g., `MiningConfig`, `AppState`)
- Variables: `snake_case` (e.g., `miner_state`, `config`)
- Constants: `SCREAMING_SNAKE_CASE`

#### Code Structure
```rust
// Tauri commands
#[tauri::command]
fn start_mining(
    state: State<'_, AppState>,
    config: MiningConfig,
) -> Result<String, String> {
    let mut miner = state.miner.lock().map_err(|e| e.to_string())?;
    miner.start(config)
}

// State management
struct AppState {
    miner: Mutex<MinerState>,
}
```

### General Guidelines

#### Security
- Never log sensitive information (wallet addresses, private keys)
- Validate all user inputs before processing
- Use HTTPS for network communications
- Follow principle of least privilege

#### Performance
- Avoid blocking operations on main threads
- Use appropriate concurrency patterns (Coroutines, async/await, etc.)
- Optimize for battery life in mobile applications
- Implement proper caching strategies

#### Error Handling
- Provide user-friendly error messages
- Log technical details for debugging
- Gracefully handle network failures
- Implement retry mechanisms for transient failures

#### Testing
- Write unit tests for business logic
- Use descriptive test names
- Test edge cases and error conditions
- Maintain test coverage above 80%

#### Code Quality
- Follow platform-specific conventions
- Use static analysis tools (lint, detekt, etc.)
- Keep functions focused and testable
- Document complex algorithms and decisions

## Platform-Specific Considerations

### Android
- Target API 21+ for broad compatibility
- Use WorkManager for background mining tasks
- Implement proper permission handling
- Follow Material Design guidelines

### iOS
- Respect App Store mining restrictions
- Implement proper background task handling
- Use SwiftUI for modern UI development
- Follow Apple's Human Interface Guidelines

### Web
- Ensure cross-browser compatibility
- Handle WebSocket connection management
- Implement proper security headers
- Optimize for mobile web performance

### Desktop
- Support Windows, macOS, and Linux
- Handle system-specific path differences
- Implement proper process management
- Follow platform-specific UI conventions

## Development Workflow

1. **Branching**: Create feature branches from `main`
2. **Testing**: Run full test suite before commits
3. **Linting**: Fix all lint issues before PR
4. **Building**: Verify builds on all target platforms
5. **Code Review**: All changes require review
6. **CI/CD**: Automated testing via GitHub Actions (`android-ci.yml`, `web-miner-ci.yml`). Tag `v*` runs `release.yml` and publishes Android/Wear APKs, Web zips, and Desktop Linux/Windows/macOS installers (see [docs/platforms.md](docs/platforms.md#releases-github-actions); example [v2.3.0](https://github.com/ImL1s/xmrig-multi/releases/tag/v2.3.0)). Keep platform version strings aligned with the tag.

## Dependencies

### Version Management
- Use `gradle/libs.versions.toml` for Android dependencies
- Pin exact versions to ensure reproducibility
- Keep dependencies updated but stable
- Document breaking changes in updates

### Adding Dependencies
- Evaluate necessity and maintenance burden
- Prefer established, well-maintained libraries
- Check license compatibility
- Update both build files and version catalog

## File Organization

```
xmrig-multi/
├── docs/                   # Building, platforms, fee guides
├── app/                    # Android application
│   ├── src/main/java/.../  # Source code by feature
│   │   ├── data/           # Data layer (models, repositories)
│   │   ├── presentation/   # UI layer (screens, ViewModels)
│   │   └── service/        # Background services
│   └── src/test/           # Unit tests
├── ios/                    # iOS application
├── web/                    # Web application
├── desktop/                # Desktop application
└── scripts/                # Build and utility scripts
```

This document should be updated as the codebase evolves and new patterns emerge.