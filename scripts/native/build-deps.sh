#!/usr/bin/env bash
# Cross-compile pinned libuv + OpenSSL for Android arm64 API 21 (#134).
# Uses NDK LLVM aarch64-linux-android${API}-clang — never host Ubuntu libs.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=versions.env
source "$SCRIPT_DIR/versions.env"

if [[ -z "${ANDROID_NDK_HOME:-}" ]]; then
  echo "ERROR: ANDROID_NDK_HOME is not set" >&2
  exit 1
fi
if [[ -z "${DEPS_PREFIX:-}" ]]; then
  echo "ERROR: DEPS_PREFIX is not set (install prefix for OpenSSL/libuv)" >&2
  exit 1
fi
if [[ -z "${WORK_DIR:-}" ]]; then
  echo "ERROR: WORK_DIR is not set" >&2
  exit 1
fi

HOST_TAG=""
for candidate in linux-x86_64 darwin-x86_64 darwin-arm64 windows-x86_64; do
  if [[ -d "$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/$candidate" ]]; then
    HOST_TAG="$candidate"
    break
  fi
done
if [[ -z "$HOST_TAG" ]]; then
  echo "ERROR: No NDK LLVM prebuilt toolchain under $ANDROID_NDK_HOME" >&2
  exit 1
fi

TOOLCHAIN="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/$HOST_TAG"
export PATH="$TOOLCHAIN/bin:$PATH"
export AR="$TOOLCHAIN/bin/llvm-ar"
export AS="$TOOLCHAIN/bin/${ANDROID_TRIPLE}${ANDROID_API}-clang"
export CC="$TOOLCHAIN/bin/${ANDROID_TRIPLE}${ANDROID_API}-clang"
export CXX="$TOOLCHAIN/bin/${ANDROID_TRIPLE}${ANDROID_API}-clang++"
export LD="$TOOLCHAIN/bin/ld"
export RANLIB="$TOOLCHAIN/bin/llvm-ranlib"
export STRIP="$TOOLCHAIN/bin/llvm-strip"

mkdir -p "$WORK_DIR/downloads" "$DEPS_PREFIX"
DOWNLOADS="$WORK_DIR/downloads"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

fetch_pinned() {
  local url="$1" out="$2" expect="$3"
  if [[ -f "$out" ]]; then
    local got
    got="$(sha256_file "$out")"
    if [[ "$got" == "$expect" ]]; then
      echo "✓ Cached $(basename "$out") ($got)"
      return 0
    fi
    echo "⚠️  Hash mismatch for cached $(basename "$out"); re-downloading"
    rm -f "$out"
  fi
  echo "📥 Fetching $(basename "$out")..."
  curl -fsSL --retry 3 -o "$out" "$url"
  local got
  got="$(sha256_file "$out")"
  if [[ "$got" != "$expect" ]]; then
    echo "ERROR: SHA256 mismatch for $(basename "$out")" >&2
    echo "  expected: $expect" >&2
    echo "  got:      $got" >&2
    exit 1
  fi
  echo "✓ Verified $(basename "$out") ($got)"
}

build_openssl() {
  if [[ -f "$DEPS_PREFIX/lib/libssl.a" && -f "$DEPS_PREFIX/lib/libcrypto.a" ]]; then
    echo "✓ OpenSSL already installed at $DEPS_PREFIX"
    return 0
  fi

  fetch_pinned "$OPENSSL_URL" "$DOWNLOADS/$OPENSSL_TARBALL" "$OPENSSL_SHA256"
  local src="$WORK_DIR/openssl-src"
  rm -rf "$src"
  mkdir -p "$src"
  tar -xzf "$DOWNLOADS/$OPENSSL_TARBALL" -C "$src" --strip-components=1
  pushd "$src" >/dev/null

  # Official Android target; API via -D__ANDROID_API__ (NDK other_build_systems).
  export ANDROID_NDK_ROOT="$ANDROID_NDK_HOME"
  ./Configure android-arm64 \
    -D__ANDROID_API__="$ANDROID_API" \
    no-shared \
    no-tests \
    no-ui-console \
    --prefix="$DEPS_PREFIX" \
    --openssldir="$DEPS_PREFIX/ssl"

  make -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"
  make install_sw
  popd >/dev/null

  # Refuse host contamination: objects must be ELF aarch64.
  if command -v readelf >/dev/null 2>&1; then
    local machine
    machine="$(readelf -h "$DEPS_PREFIX/lib/libcrypto.a" 2>/dev/null | awk '/Machine:/{print $2,$3; exit}' || true)"
    # Archive may not show Machine; check a .o extracted if needed — file(1) is enough.
  fi
  file "$DEPS_PREFIX/lib/libcrypto.a" | tee "$WORK_DIR/openssl-libcrypto.file"
  if file "$DEPS_PREFIX/lib/libcrypto.a" | grep -qiE 'x86-64|Intel 80386|i386'; then
    echo "ERROR: OpenSSL linked/built as host x86 — refusing" >&2
    exit 1
  fi
  echo "✓ OpenSSL $OPENSSL_VERSION installed (static) → $DEPS_PREFIX"
}

build_libuv() {
  if [[ -f "$DEPS_PREFIX/lib/libuv.a" || -f "$DEPS_PREFIX/lib/libuv.so" ]]; then
    echo "✓ libuv already installed at $DEPS_PREFIX"
  else
  fetch_pinned "$LIBUV_URL" "$DOWNLOADS/$LIBUV_TARBALL" "$LIBUV_SHA256"
  local src="$WORK_DIR/libuv-src"
  rm -rf "$src"
  mkdir -p "$src"
  tar -xzf "$DOWNLOADS/$LIBUV_TARBALL" -C "$src" --strip-components=1
  local build="$WORK_DIR/libuv-build"
  rm -rf "$build"
  mkdir -p "$build"

  cmake -S "$src" -B "$build" \
    -DCMAKE_TOOLCHAIN_FILE="$ANDROID_NDK_HOME/build/cmake/android.toolchain.cmake" \
    -DANDROID_ABI="$ANDROID_ABI" \
    -DANDROID_PLATFORM="android-$ANDROID_API" \
    -DANDROID_STL=c++_shared \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$DEPS_PREFIX" \
    -DBUILD_SHARED_LIBS=OFF \
    -DLIBUV_BUILD_SHARED=OFF \
    -DLIBUV_BUILD_TESTS=OFF \
    -DLIBUV_BUILD_BENCH=OFF

  # Only the static archive — shared libuv.so fails to link unused symbols on older API.
  cmake --build "$build" --target uv_a -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"
  # Install headers + static lib without building shared target
  mkdir -p "$DEPS_PREFIX/include" "$DEPS_PREFIX/lib"
  cp -a "$src/include/uv.h" "$DEPS_PREFIX/include/"
  cp -a "$src/include/uv" "$DEPS_PREFIX/include/"
  cp "$build/libuv.a" "$DEPS_PREFIX/lib/libuv.a" 2>/dev/null || cp "$build/libuv_a.a" "$DEPS_PREFIX/lib/libuv.a"

  file "$DEPS_PREFIX/lib/libuv.a" | tee "$WORK_DIR/libuv.file"
  if file "$DEPS_PREFIX/lib/libuv.a" | grep -qiE 'x86-64|Intel 80386|i386'; then
    echo "ERROR: libuv built as host x86 — refusing" >&2
    exit 1
  fi
  echo "✓ libuv $LIBUV_VERSION installed (static) → $DEPS_PREFIX"
  fi

  # Android Bionic has pthread/rt in libc; XMRig/libuv still pass -lpthread -lrt.
  # Provide empty static archives so the link line resolves without host libs.
  local ar_tool="$TOOLCHAIN/bin/llvm-ar"
  "$ar_tool" rcs "$DEPS_PREFIX/lib/libpthread.a"
  "$ar_tool" rcs "$DEPS_PREFIX/lib/librt.a"
  echo "✓ Stub libpthread.a / librt.a for Android link"
}

echo "======================================"
echo "Android native deps (OpenSSL + libuv)"
echo "======================================"
echo "NDK:     $ANDROID_NDK_HOME"
echo "Host:    $HOST_TAG"
echo "API/ABI: android-$ANDROID_API / $ANDROID_ABI"
echo "Prefix:  $DEPS_PREFIX"
echo ""

build_openssl
build_libuv

# Record linkage + licenses for the manifest generator.
cat > "$DEPS_PREFIX/NATIVE_DEPS.json" <<EOF
{
  "openssl": {
    "version": "$OPENSSL_VERSION",
    "url": "$OPENSSL_URL",
    "sha256": "$OPENSSL_SHA256",
    "license": "$OPENSSL_LICENSE",
    "linkage": "static",
    "library": "lib/libssl.a+libcrypto.a"
  },
  "libuv": {
    "version": "$LIBUV_VERSION",
    "url": "$LIBUV_URL",
    "sha256": "$LIBUV_SHA256",
    "license": "$LIBUV_LICENSE",
    "linkage": "static",
    "library": "lib/libuv.a"
  }
}
EOF

echo "✅ Dependencies ready"
