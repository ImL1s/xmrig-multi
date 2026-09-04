# Contributing to XMRig Miner

First off, thank you for considering contributing to XMRig Miner! 🎉

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues to avoid duplicates.

When filing an issue, please include:
- **Device info**: Model, Android version, CPU architecture
- **App version**: Check in Settings
- **Steps to reproduce**: Clear steps to reproduce the issue
- **Expected behavior**: What should happen
- **Actual behavior**: What actually happens
- **Logs**: If available (Settings → Debug → Export Logs)

### Suggesting Enhancements

Enhancement suggestions are welcome! Please:
1. Check if the feature has already been requested
2. Open an issue with the `enhancement` label
3. Describe the feature and its use case

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`./gradlew :app:testDebugUnitTest`)
5. Run lint (`./gradlew :app:lintDebug`)
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

## Development Setup

### Prerequisites

- Android Studio Hedgehog (2023.1.1)+
- JDK 17
- Android SDK 34
- NDK 26.x

### Build

```bash
# Clone
git clone https://github.com/ImL1s/xmrig-android.git
cd xmrig-android

# Native XMRig is already in jniLibs for arm64 — see docs/building.md
./scripts/build_xmrig.sh   # only when rebuilding XMRig / fee sources

# Build
./gradlew :app:assembleDebug

# Run tests
./gradlew :app:testDebugUnitTest

# Run lint
./gradlew :app:lintDebug
```

## Code Style

- Follow [Kotlin Coding Conventions](https://kotlinlang.org/docs/coding-conventions.html)
- Use meaningful variable and function names
- Add comments for complex logic
- Write unit tests for new functionality

## License

By contributing, you agree that your contributions will be licensed under the GPL-3.0 License.
