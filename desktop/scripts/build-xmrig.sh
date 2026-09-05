#!/bin/bash
# Build XMRig binaries for Desktop platforms
# with custom dev fee configuration (1% to app developer)
#
# This script builds XMRig from source to include custom dev fee settings.
# For quick testing, you can use --download to get pre-built binaries (but without custom dev fee).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$PROJECT_DIR")"
BINARIES_DIR="$PROJECT_DIR/src-tauri/binaries"
CUSTOM_SOURCE_DIR="$ROOT_DIR/xmrig_custom_source"
XMRIG_VERSION="6.21.0"

mkdir -p "$BINARIES_DIR"

# Detect platform
case "$(uname -s)" in
    Darwin*)
        PLATFORM="macos"
        if [[ "$(uname -m)" == "arm64" ]]; then
            ARCH="arm64"
        else
            ARCH="x64"
        fi
        BINARY_NAME="xmrig"
        ;;
    Linux*)
        PLATFORM="linux"
        ARCH="x64"
        BINARY_NAME="xmrig"
        ;;
    MINGW*|MSYS*|CYGWIN*)
        PLATFORM="windows"
        ARCH="x64"
        BINARY_NAME="xmrig.exe"
        ;;
    *)
        echo "Unsupported platform: $(uname -s)"
        exit 1
        ;;
esac

echo "=== XMRig Desktop Build Script ==="
echo "Platform: $PLATFORM"
echo "Architecture: $ARCH"
echo "Version: $XMRIG_VERSION"
echo "Dev Fee: 1%"
echo ""

# Check if --download flag is used (downloads pre-built, no custom dev fee)
if [[ "$1" == "--download" ]]; then
    echo "⚠️  Using pre-built binaries (dev fee goes to XMRig authors, not custom wallet)"
    echo ""

    case "$PLATFORM" in
        macos)
            DOWNLOAD_URL="https://github.com/xmrig/xmrig/releases/download/v${XMRIG_VERSION}/xmrig-${XMRIG_VERSION}-macos-${ARCH}.tar.gz"
            ;;
        linux)
            DOWNLOAD_URL="https://github.com/xmrig/xmrig/releases/download/v${XMRIG_VERSION}/xmrig-${XMRIG_VERSION}-linux-static-x64.tar.gz"
            ;;
        windows)
            DOWNLOAD_URL="https://github.com/xmrig/xmrig/releases/download/v${XMRIG_VERSION}/xmrig-${XMRIG_VERSION}-msvc-win64.zip"
            ;;
    esac

    TEMP_DIR=$(mktemp -d)
    cd "$TEMP_DIR"

    echo "Downloading XMRig..."
    curl -L -o xmrig-archive "$DOWNLOAD_URL"

    echo "Extracting..."
    if [[ "$PLATFORM" == "windows" ]]; then
        unzip -q xmrig-archive
    else
        tar -xzf xmrig-archive
    fi

    XMRIG_BIN=$(find . -name "$BINARY_NAME" -type f | head -1)
    if [[ -z "$XMRIG_BIN" ]]; then
        echo "Error: XMRig binary not found"
        exit 1
    fi

    cp "$XMRIG_BIN" "$BINARIES_DIR/$BINARY_NAME"
    chmod +x "$BINARIES_DIR/$BINARY_NAME"
    rm -rf "$TEMP_DIR"

    echo ""
    echo "=== Download Complete ==="
    echo "Binary: $BINARIES_DIR/$BINARY_NAME"
    echo "⚠️  Note: This binary uses XMRig's original dev fee wallet, not the custom one."
    exit 0
fi

# Build from source with custom dev fee
echo "🔨 Building XMRig from source with custom dev fee..."
echo ""

# Check dependencies
command -v cmake >/dev/null 2>&1 || {
    echo "❌ Error: cmake is not installed"
    if [[ "$PLATFORM" == "macos" ]]; then
        echo "Install with: brew install cmake"
    elif [[ "$PLATFORM" == "linux" ]]; then
        echo "Install with: sudo apt install cmake"
    fi
    exit 1
}

command -v git >/dev/null 2>&1 || {
    echo "❌ Error: git is not installed"
    exit 1
}

# Clone XMRig source
XMRIG_SRC_DIR="/tmp/xmrig-desktop"
if [ -d "$XMRIG_SRC_DIR" ]; then
    echo "Removing existing source..."
    rm -rf "$XMRIG_SRC_DIR"
fi

echo "📥 Cloning XMRig v$XMRIG_VERSION..."
git clone --depth 1 --branch "v$XMRIG_VERSION" https://github.com/xmrig/xmrig.git "$XMRIG_SRC_DIR"

cd "$XMRIG_SRC_DIR"

# Apply custom dev fee configuration
echo ""
echo "🔧 Applying custom dev fee configuration..."
if [ -f "$CUSTOM_SOURCE_DIR/donate.h" ]; then
    cp "$CUSTOM_SOURCE_DIR/donate.h" "$XMRIG_SRC_DIR/src/donate.h"
    echo "✓ Applied custom donate.h (1% dev fee)"
else
    echo "⚠️  Custom donate.h not found"
fi

if [ -f "$CUSTOM_SOURCE_DIR/DonateStrategy.cpp" ]; then
    cp "$CUSTOM_SOURCE_DIR/DonateStrategy.cpp" "$XMRIG_SRC_DIR/src/net/strategies/DonateStrategy.cpp"
    echo "✓ Applied custom DonateStrategy.cpp (custom wallet)"
else
    echo "⚠️  Custom DonateStrategy.cpp not found"
fi

# Verify wallet address
echo ""
echo "📋 Verifying dev fee wallet address..."
if grep -q "8AfUwcnoJiRDMXnDGj3zX6bMgfaj9pM1WFGr2pakLm3jSYXVLD5fcDMBzkmk4AeSqWYQTA5aerXJ43W65AT82RMqG6NDBnC" "$XMRIG_SRC_DIR/src/net/strategies/DonateStrategy.cpp"; then
    echo "✓ Dev fee wallet address verified"
else
    echo "❌ Warning: Dev fee wallet address not found in source!"
fi

# Build
echo ""
echo "🔨 Building for $PLATFORM-$ARCH..."
mkdir -p build
cd build

cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
    -DWITH_HWLOC=OFF \
    -DWITH_TLS=ON \
    -DWITH_HTTP=ON \
    -DWITH_OPENCL=OFF \
    -DWITH_CUDA=OFF

JOBS=$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)
if [[ "$PLATFORM" == "windows" ]]; then
    cmake --build . --config Release -j "$JOBS"
    if [ -f "Release/xmrig.exe" ]; then
        BINARY_NAME="Release/xmrig.exe"
    elif [ -f "xmrig.exe" ]; then
        BINARY_NAME="xmrig.exe"
    fi
else
    cmake --build . -j "$JOBS"
fi

# Verify and copy binary
if [ ! -f "$BINARY_NAME" ]; then
    # Try looking for xmrig without extension
    if [ -f "xmrig" ]; then
        BINARY_NAME="xmrig"
    else
        echo "❌ Error: Build failed, binary not found"
        exit 1
    fi
fi

echo ""
echo "✓ Build complete!"
ls -lh "$BINARY_NAME"

# Strip binary (reduce size)
if [[ "$PLATFORM" != "windows" ]]; then
    echo "🔧 Stripping binary..."
    strip "$BINARY_NAME" 2>/dev/null || true
fi

# Copy to binaries directory (plain name + Tauri externalBin target triple)
SRC_BIN="$BINARY_NAME"
OUT_BASE=$(basename "$SRC_BIN")
cp "$SRC_BIN" "$BINARIES_DIR/$OUT_BASE"
chmod +x "$BINARIES_DIR/$OUT_BASE"

case "$PLATFORM" in
    linux)
        cp "$BINARIES_DIR/$OUT_BASE" "$BINARIES_DIR/xmrig-x86_64-unknown-linux-gnu"
        chmod +x "$BINARIES_DIR/xmrig-x86_64-unknown-linux-gnu"
        ;;
    windows)
        cp "$BINARIES_DIR/$OUT_BASE" "$BINARIES_DIR/xmrig-x86_64-pc-windows-msvc.exe"
        chmod +x "$BINARIES_DIR/xmrig-x86_64-pc-windows-msvc.exe"
        ;;
    macos)
        if [[ "$ARCH" == "arm64" ]]; then
            cp "$BINARIES_DIR/$OUT_BASE" "$BINARIES_DIR/xmrig-aarch64-apple-darwin"
            chmod +x "$BINARIES_DIR/xmrig-aarch64-apple-darwin"
        else
            cp "$BINARIES_DIR/$OUT_BASE" "$BINARIES_DIR/xmrig-x86_64-apple-darwin"
            chmod +x "$BINARIES_DIR/xmrig-x86_64-apple-darwin"
        fi
        ;;
esac

# Cleanup
cd /
rm -rf "$XMRIG_SRC_DIR"

echo ""
echo "=== Build Complete ==="
echo "Binary: $BINARIES_DIR/$OUT_BASE"
echo ""
echo "Dev Fee: 1% to wallet:"
echo "  8AfUwcnoJiRDMXnDGj3zX6bMgfaj9pM1WFGr2pakLm3jSYXVLD5fcDMBzkmk4AeSqWYQTA5aerXJ43W65AT82RMqG6NDBnC"
echo ""

# Verify
"$BINARIES_DIR/$OUT_BASE" --version 2>/dev/null || echo "Note: Run binary manually to verify"
