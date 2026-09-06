#!/usr/bin/env bash
# Build Android arm64 XMRig with TLS / HTTP / benchmark (#134).
# Cross-compiles pinned OpenSSL + libuv via scripts/native/build-deps.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=native/versions.env
source "$SCRIPT_DIR/native/versions.env"

ASSETS_DIR="$PROJECT_ROOT/app/src/main/assets"
JNLIB_DIR="$PROJECT_ROOT/app/src/main/jniLibs/arm64-v8a"
CUSTOM_SOURCE_DIR="$PROJECT_ROOT/xmrig_custom_source"
NATIVE_DIR="$SCRIPT_DIR/native"

echo "======================================"
echo "XMRig Android Build Script (#134)"
echo "======================================"
echo "XMRig:     $XMRIG_VERSION"
echo "API/ABI:   android-$ANDROID_API / $ANDROID_ABI"
echo "Features:  WITH_HTTP=$WITH_HTTP WITH_TLS=$WITH_TLS WITH_BENCHMARK=$WITH_BENCHMARK WITH_HWLOC=$WITH_HWLOC"
echo ""

if [[ -z "${ANDROID_NDK_HOME:-}" ]]; then
  echo "ERROR: ANDROID_NDK_HOME is not set" >&2
  exit 1
fi
command -v cmake >/dev/null 2>&1 || { echo "ERROR: cmake is not installed" >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo "ERROR: git is not installed" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "ERROR: curl is not installed" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 is not installed" >&2; exit 1; }

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/xmrig-android-XXXXXX")"
DEPS_PREFIX="$WORK_DIR/deps-prefix"
KEEP_WORK="${KEEP_XMRIG_WORK:-0}"

cleanup() {
  if [[ "$KEEP_WORK" == "1" ]]; then
    echo "KEEP_XMRIG_WORK=1 — leaving work dir: $WORK_DIR"
  else
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT

export WORK_DIR DEPS_PREFIX ANDROID_NDK_HOME

echo "✓ NDK: $ANDROID_NDK_HOME"
echo "✓ Work: $WORK_DIR"
echo ""

# --- Dependencies (OpenSSL + libuv, never host Ubuntu libs) ---
chmod +x "$NATIVE_DIR/build-deps.sh" "$NATIVE_DIR/generate-manifest.sh" "$NATIVE_DIR/smoke-native.sh"
"$NATIVE_DIR/build-deps.sh"

UV_INCLUDE_DIR="$DEPS_PREFIX/include"
UV_LIBRARY="$DEPS_PREFIX/lib/libuv.a"
OPENSSL_ROOT_DIR="$DEPS_PREFIX"
OPENSSL_INCLUDE_DIR="$DEPS_PREFIX/include"
OPENSSL_CRYPTO_LIBRARY="$DEPS_PREFIX/lib/libcrypto.a"
OPENSSL_SSL_LIBRARY="$DEPS_PREFIX/lib/libssl.a"

[[ -f "$UV_LIBRARY" ]] || { echo "ERROR: libuv missing at $UV_LIBRARY" >&2; exit 1; }
[[ -f "$OPENSSL_SSL_LIBRARY" ]] || { echo "ERROR: OpenSSL missing at $OPENSSL_SSL_LIBRARY" >&2; exit 1; }

# --- Clone XMRig ---
XMRIG_SRC="$WORK_DIR/xmrig"
echo "📥 Cloning XMRig $XMRIG_VERSION..."
git clone --depth 1 --branch "$XMRIG_VERSION" https://github.com/xmrig/xmrig.git "$XMRIG_SRC"
ENGINE_COMMIT="$(git -C "$XMRIG_SRC" rev-parse HEAD)"

# --- Custom 1% fee patches ---
echo "🔧 Applying xmrig_custom_source patches..."
if [[ -f "$CUSTOM_SOURCE_DIR/donate.h" ]]; then
  cp "$CUSTOM_SOURCE_DIR/donate.h" "$XMRIG_SRC/src/donate.h"
  echo "✓ donate.h"
else
  echo "WARNING: custom donate.h not found"
fi
if [[ -f "$CUSTOM_SOURCE_DIR/DonateStrategy.cpp" ]]; then
  cp "$CUSTOM_SOURCE_DIR/DonateStrategy.cpp" "$XMRIG_SRC/src/net/strategies/DonateStrategy.cpp"
  echo "✓ DonateStrategy.cpp"
else
  echo "WARNING: custom DonateStrategy.cpp not found"
fi

CUSTOM_PATCH_HASH=""
if command -v sha256sum >/dev/null 2>&1; then
  CUSTOM_PATCH_HASH="$( (cat "$CUSTOM_SOURCE_DIR/donate.h" "$CUSTOM_SOURCE_DIR/DonateStrategy.cpp" 2>/dev/null || true) | sha256sum | awk '{print $1}' )"
elif command -v shasum >/dev/null 2>&1; then
  CUSTOM_PATCH_HASH="$( (cat "$CUSTOM_SOURCE_DIR/donate.h" "$CUSTOM_SOURCE_DIR/DonateStrategy.cpp" 2>/dev/null || true) | shasum -a 256 | awk '{print $1}' )"
fi

# --- CMake configure ---
BUILD_DIR="$XMRIG_SRC/build/android/arm64"
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# Resolve NDK host tag for strip later
HOST_TAG=""
for candidate in linux-x86_64 darwin-x86_64 darwin-arm64 windows-x86_64; do
  if [[ -d "$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/$candidate" ]]; then
    HOST_TAG="$candidate"
    break
  fi
done

# pthread/rt stubs live in DEPS_PREFIX/lib — force -L so XMRig link line resolves them.
LINKER_FLAGS="-L${DEPS_PREFIX}/lib"

cmake "$XMRIG_SRC" \
  -DCMAKE_TOOLCHAIN_FILE="$ANDROID_NDK_HOME/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI="$ANDROID_ABI" \
  -DANDROID_PLATFORM="android-$ANDROID_API" \
  -DANDROID_STL=c++_shared \
  -DCMAKE_BUILD_TYPE=Release \
  -DWITH_HWLOC="$WITH_HWLOC" \
  -DWITH_TLS="$WITH_TLS" \
  -DWITH_HTTP="$WITH_HTTP" \
  -DWITH_BENCHMARK="$WITH_BENCHMARK" \
  -DWITH_OPENCL="$WITH_OPENCL" \
  -DWITH_CUDA="$WITH_CUDA" \
  -DBUILD_STATIC=OFF \
  -DUV_INCLUDE_DIR="$UV_INCLUDE_DIR" \
  -DUV_LIBRARY="$UV_LIBRARY" \
  -DOPENSSL_ROOT_DIR="$OPENSSL_ROOT_DIR" \
  -DOPENSSL_INCLUDE_DIR="$OPENSSL_INCLUDE_DIR" \
  -DOPENSSL_CRYPTO_LIBRARY="$OPENSSL_CRYPTO_LIBRARY" \
  -DOPENSSL_SSL_LIBRARY="$OPENSSL_SSL_LIBRARY" \
  -DOPENSSL_USE_STATIC_LIBS=TRUE \
  -DCMAKE_C_FLAGS="$MARCH_FLAGS" \
  -DCMAKE_CXX_FLAGS="$MARCH_FLAGS" \
  -DCMAKE_EXE_LINKER_FLAGS="$LINKER_FLAGS" \
  -DCMAKE_SHARED_LINKER_FLAGS="$LINKER_FLAGS"

CMAKE_CACHE="$BUILD_DIR/CMakeCache.txt"
verify_cmake_flag() {
  local key="$1" expect="$2"
  local got
  got="$(grep -E "^${key}:BOOL=" "$CMAKE_CACHE" | head -n1 | cut -d= -f2 || true)"
  if [[ "$got" != "$expect" ]]; then
    echo "ERROR: CMakeCache $key=$got (expected $expect)" >&2
    exit 1
  fi
  echo "✓ CMakeCache $key=$got"
}

verify_cmake_flag WITH_HTTP "$WITH_HTTP"
verify_cmake_flag WITH_TLS "$WITH_TLS"
verify_cmake_flag WITH_BENCHMARK "$WITH_BENCHMARK"
verify_cmake_flag WITH_HWLOC "$WITH_HWLOC"

JOBS="$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"
cmake --build . -j"$JOBS"

BINARY="$BUILD_DIR/xmrig"
[[ -f "$BINARY" ]] || { echo "ERROR: build failed, $BINARY missing" >&2; exit 1; }

# Strip
if [[ -n "$HOST_TAG" ]]; then
  STRIP_TOOL="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/$HOST_TAG/bin/llvm-strip"
  if [[ -x "$STRIP_TOOL" ]]; then
    "$STRIP_TOOL" "$BINARY"
    echo "✓ Stripped binary"
  fi
fi

file "$BINARY" || true
ls -lh "$BINARY"

# --- String selftests (structural; not deviceVerified) ---
# NOTE: do not `echo "$huge" | grep -q` under pipefail — grep -q closes early → SIGPIPE.
ST_HTTP="pending"
ST_TLS="pending"
ST_BENCH="pending"
ST_DAEMON="pending"
if command -v strings >/dev/null 2>&1; then
  STRINGS_FILE="$WORK_DIR/xmrig.strings"
  strings "$BINARY" > "$STRINGS_FILE" || true
  if grep -qE '/2/summary|Httpd|httpd|GET /1/' "$STRINGS_FILE"; then
    ST_HTTP="pass"
  else
    ST_HTTP="fail"
  fi
  if grep -qE 'SSL_connect|OpenSSL|TLS' "$STRINGS_FILE"; then
    ST_TLS="pass"
  else
    ST_TLS="fail"
  fi
  if grep -qiE 'benchmark' "$STRINGS_FILE"; then
    ST_BENCH="pass"
  else
    ST_BENCH="fail"
  fi
  # Solo/daemon is coupled to WITH_HTTP per upstream CMake docs.
  ST_DAEMON="$ST_HTTP"
  echo "✓ String selftests: http=$ST_HTTP tls=$ST_TLS bench=$ST_BENCH daemon=$ST_DAEMON"
  if [[ "$WITH_HTTP" == "ON" && "$ST_HTTP" != "pass" ]]; then
    echo "ERROR: WITH_HTTP=ON but HTTP API strings missing" >&2
    exit 1
  fi
  if [[ "$WITH_TLS" == "ON" && "$ST_TLS" != "pass" ]]; then
    echo "ERROR: WITH_TLS=ON but TLS strings missing" >&2
    exit 1
  fi
  if [[ "$WITH_BENCHMARK" == "ON" && "$ST_BENCH" != "pass" ]]; then
    echo "ERROR: WITH_BENCHMARK=ON but benchmark strings missing" >&2
    exit 1
  fi
else
  echo "WARNING: strings(1) unavailable — selftests left pending"
fi

# --- Package into Android project ---
mkdir -p "$ASSETS_DIR" "$JNLIB_DIR"
cp "$BINARY" "$ASSETS_DIR/xmrig_arm64"
cp "$BINARY" "$JNLIB_DIR/libxmrig.so"
chmod 644 "$ASSETS_DIR/xmrig_arm64"
chmod 755 "$JNLIB_DIR/libxmrig.so"

# NDK version label for manifest
NDK_VERSION="unknown"
if [[ -f "$ANDROID_NDK_HOME/source.properties" ]]; then
  NDK_VERSION="$(grep -E '^Pkg\.Revision' "$ANDROID_NDK_HOME/source.properties" | cut -d= -f2 | tr -d '[:space:]' || echo unknown)"
fi
# Prefer friendly tag when r26c layout
if [[ "$(basename "$ANDROID_NDK_HOME")" == *r26c* ]] || echo "$ANDROID_NDK_HOME" | grep -q r26c; then
  NDK_VERSION="android-ndk-r26c"
fi

MANIFEST_OUT="$ASSETS_DIR/native-capabilities.json"
"$NATIVE_DIR/generate-manifest.sh" \
  --binary "$ASSETS_DIR/xmrig_arm64" \
  --cmake-cache "$CMAKE_CACHE" \
  --out "$MANIFEST_OUT" \
  --engine-commit "$ENGINE_COMMIT" \
  --custom-patch-hash "$CUSTOM_PATCH_HASH" \
  --ndk-version "$NDK_VERSION" \
  --deps-json "$DEPS_PREFIX/NATIVE_DEPS.json" \
  --selftest-http "$ST_HTTP" \
  --selftest-tls "$ST_TLS" \
  --selftest-benchmark "$ST_BENCH" \
  --selftest-daemon "$ST_DAEMON"

# Mirror next to scripts for smoke/default tooling
cp "$MANIFEST_OUT" "$NATIVE_DIR/native-capabilities.json"

cat > "$NATIVE_DIR/last-build.env" <<EOF
builtAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)
engineCommit=$ENGINE_COMMIT
customPatchHash=$CUSTOM_PATCH_HASH
$(if command -v sha256sum >/dev/null 2>&1; then sha256sum "$ASSETS_DIR/xmrig_arm64"; else shasum -a 256 "$ASSETS_DIR/xmrig_arm64"; fi)
EOF

echo ""
echo "======================================"
echo "✅ Build Complete (#134)"
echo "======================================"
echo "  $JNLIB_DIR/libxmrig.so"
echo "  $ASSETS_DIR/xmrig_arm64"
echo "  $MANIFEST_OUT"
echo ""
echo "Next: ./scripts/native/smoke-native.sh"
echo "Dev fee wallet: 8AfUwcnoJiRDMXnDGj3zX6bMgfaj9pM1WFGr2pakLm3jSYXVLD5fcDMBzkmk4AeSqWYQTA5aerXJ43W65AT82RMqG6NDBnC"
echo ""
