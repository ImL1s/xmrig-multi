#!/usr/bin/env bash
# Generate native-capabilities.json from actual CMakeCache + binary SHA-256 (#134).
# Declared / selftest / deviceVerified are separate fields — never invent deviceVerified=true.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=versions.env
source "$SCRIPT_DIR/versions.env"

usage() {
  cat <<'EOF'
Usage: generate-manifest.sh --binary PATH --cmake-cache PATH --out PATH
                            [--engine-commit SHA] [--custom-patch-hash SHA]
                            [--ndk-version STR] [--deps-json PATH]
                            [--selftest-http pending|pass|fail|skipped]
                            [--selftest-tls pending|pass|fail|skipped]
                            [--selftest-benchmark pending|pass|fail|skipped]
                            [--selftest-daemon pending|pass|fail|skipped]
EOF
  exit 1
}

BINARY=""
CMAKE_CACHE=""
OUT=""
ENGINE_COMMIT=""
CUSTOM_PATCH_HASH=""
NDK_VERSION="${ANDROID_NDK_VERSION:-unknown}"
DEPS_JSON=""
ST_HTTP="pending"
ST_TLS="pending"
ST_BENCH="pending"
ST_DAEMON="pending"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --binary) BINARY="$2"; shift 2 ;;
    --cmake-cache) CMAKE_CACHE="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --engine-commit) ENGINE_COMMIT="$2"; shift 2 ;;
    --custom-patch-hash) CUSTOM_PATCH_HASH="$2"; shift 2 ;;
    --ndk-version) NDK_VERSION="$2"; shift 2 ;;
    --deps-json) DEPS_JSON="$2"; shift 2 ;;
    --selftest-http) ST_HTTP="$2"; shift 2 ;;
    --selftest-tls) ST_TLS="$2"; shift 2 ;;
    --selftest-benchmark) ST_BENCH="$2"; shift 2 ;;
    --selftest-daemon) ST_DAEMON="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown arg: $1" >&2; usage ;;
  esac
done

[[ -n "$BINARY" && -f "$BINARY" ]] || { echo "ERROR: --binary required" >&2; exit 1; }
[[ -n "$CMAKE_CACHE" && -f "$CMAKE_CACHE" ]] || { echo "ERROR: --cmake-cache required" >&2; exit 1; }
[[ -n "$OUT" ]] || { echo "ERROR: --out required" >&2; exit 1; }

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

cmake_bool() {
  # Reads WITH_FOO:BOOL=ON from CMakeCache.txt
  local key="$1"
  local line
  line="$(grep -E "^${key}:BOOL=" "$CMAKE_CACHE" | head -n1 || true)"
  if [[ -z "$line" ]]; then
    echo "unknown"
    return
  fi
  echo "${line#*=}"
}

on_to_bool() {
  case "$1" in
    ON|on|TRUE|true|1) echo true ;;
    OFF|off|FALSE|false|0) echo false ;;
    *) echo false ;;
  esac
}

HTTP_VAL="$(cmake_bool WITH_HTTP)"
TLS_VAL="$(cmake_bool WITH_TLS)"
BENCH_VAL="$(cmake_bool WITH_BENCHMARK)"
HWLOC_VAL="$(cmake_bool WITH_HWLOC)"
OPENCL_VAL="$(cmake_bool WITH_OPENCL)"
CUDA_VAL="$(cmake_bool WITH_CUDA)"

HTTP_DECL="$(on_to_bool "$HTTP_VAL")"
TLS_DECL="$(on_to_bool "$TLS_VAL")"
BENCH_DECL="$(on_to_bool "$BENCH_VAL")"
HWLOC_DECL="$(on_to_bool "$HWLOC_VAL")"
# Daemon solo requires HTTP support in XMRig (official CMake docs).
DAEMON_DECL="$HTTP_DECL"

BINARY_SHA="$(sha256_file "$BINARY")"
BINARY_SIZE="$(wc -c < "$BINARY" | tr -d ' ')"
BINARY_FILE="$(file -b "$BINARY" 2>/dev/null || echo unknown)"

DEPS_PATH_ARG=""
if [[ -n "$DEPS_JSON" && -f "$DEPS_JSON" ]]; then
  DEPS_PATH_ARG="$DEPS_JSON"
fi

GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
HOST_UNAME="$(uname -s)-$(uname -m)"

mkdir -p "$(dirname "$OUT")"

# Use python for reliable JSON (available on CI + WSL).
export GEN_OUT="$OUT"
export GEN_DEPS_PATH="$DEPS_PATH_ARG"
export GEN_ENGINE_COMMIT="$ENGINE_COMMIT"
export GEN_CUSTOM_PATCH_HASH="$CUSTOM_PATCH_HASH"
export GEN_NDK_VERSION="$NDK_VERSION"
export GEN_BINARY_SHA="$BINARY_SHA"
export GEN_BINARY_SIZE="$BINARY_SIZE"
export GEN_BINARY_FILE="$BINARY_FILE"
export GEN_HTTP_VAL="$HTTP_VAL"
export GEN_TLS_VAL="$TLS_VAL"
export GEN_BENCH_VAL="$BENCH_VAL"
export GEN_HWLOC_VAL="$HWLOC_VAL"
export GEN_OPENCL_VAL="$OPENCL_VAL"
export GEN_CUDA_VAL="$CUDA_VAL"
export GEN_HTTP_DECL="$HTTP_DECL"
export GEN_TLS_DECL="$TLS_DECL"
export GEN_BENCH_DECL="$BENCH_DECL"
export GEN_HWLOC_DECL="$HWLOC_DECL"
export GEN_DAEMON_DECL="$DAEMON_DECL"
export GEN_ST_HTTP="$ST_HTTP"
export GEN_ST_TLS="$ST_TLS"
export GEN_ST_BENCH="$ST_BENCH"
export GEN_ST_DAEMON="$ST_DAEMON"
export GEN_GENERATED_AT="$GENERATED_AT"
export GEN_HOST_UNAME="$HOST_UNAME"
export GEN_XMRIG_VERSION="$XMRIG_VERSION"
export GEN_ANDROID_API="$ANDROID_API"
export GEN_ANDROID_ABI="$ANDROID_ABI"
export GEN_ANDROID_TRIPLE="$ANDROID_TRIPLE"
export GEN_REQUIRED_CPU_INSTRUCTIONS="$REQUIRED_CPU_INSTRUCTIONS"

python3 <<'PY'
import json, os

def b(s):
    return str(s).lower() in ("true", "1", "on")

deps = {}
deps_path = os.environ.get("GEN_DEPS_PATH") or ""
if deps_path and os.path.isfile(deps_path):
    with open(deps_path, encoding="utf-8") as f:
        deps = json.load(f)

http_decl = b(os.environ["GEN_HTTP_DECL"])
tls_decl = b(os.environ["GEN_TLS_DECL"])
bench_decl = b(os.environ["GEN_BENCH_DECL"])
hwloc_decl = b(os.environ["GEN_HWLOC_DECL"])
daemon_decl = b(os.environ["GEN_DAEMON_DECL"])

doc = {
  "schemaVersion": 1,
  "generatedAt": os.environ["GEN_GENERATED_AT"],
  "issue": "#134",
  "engine": {
    "name": "xmrig",
    "tag": os.environ["GEN_XMRIG_VERSION"],
    "commit": os.environ.get("GEN_ENGINE_COMMIT") or None,
    "customPatchHash": os.environ.get("GEN_CUSTOM_PATCH_HASH") or None
  },
  "toolchain": {
    "ndk": os.environ["GEN_NDK_VERSION"],
    "api": int(os.environ["GEN_ANDROID_API"]),
    "abi": os.environ["GEN_ANDROID_ABI"],
    "triple": os.environ["GEN_ANDROID_TRIPLE"],
    "host": os.environ["GEN_HOST_UNAME"],
    "march": "armv8-a+crypto"
  },
  "dependencies": deps,
  "cmake": {
    "WITH_HTTP": os.environ["GEN_HTTP_VAL"],
    "WITH_TLS": os.environ["GEN_TLS_VAL"],
    "WITH_BENCHMARK": os.environ["GEN_BENCH_VAL"],
    "WITH_HWLOC": os.environ["GEN_HWLOC_VAL"],
    "WITH_OPENCL": os.environ["GEN_OPENCL_VAL"],
    "WITH_CUDA": os.environ["GEN_CUDA_VAL"]
  },
  "binary": {
    "path": "libxmrig.so",
    "asset": "xmrig_arm64",
    "sha256": os.environ["GEN_BINARY_SHA"],
    "size": int(os.environ["GEN_BINARY_SIZE"]),
    "file": os.environ["GEN_BINARY_FILE"]
  },
  "cpu": {
    "requiredInstructions": [s for s in os.environ["GEN_REQUIRED_CPU_INSTRUCTIONS"].split() if s],
    "march": "armv8-a+crypto",
    "sigillPolicy": "refuse-start-when-features-missing"
  },
  "capabilities": {
    "httpApi": {
      "declared": http_decl,
      "selftest": os.environ["GEN_ST_HTTP"],
      "deviceVerified": False,
      "bind": "127.0.0.1",
      "auth": "per-session-token",
      "remoteControlDefault": False,
      "writeEndpoints": "token-required-loopback-only"
    },
    "tls": {
      "declared": tls_decl,
      "selftest": os.environ["GEN_ST_TLS"],
      "deviceVerified": False,
      "trustModel": "fingerprint",
      "note": "XMRig pool TLS verifies certificate fingerprint when configured; this is not full CA/hostname identity verification."
    },
    "benchmark": {
      "declared": bench_decl,
      "selftest": os.environ["GEN_ST_BENCH"],
      "deviceVerified": False,
      "offline": True,
      "note": "Offline RandomX --bench; not network stress."
    },
    "daemon": {
      "declared": daemon_decl,
      "selftest": os.environ["GEN_ST_DAEMON"],
      "deviceVerified": False,
      "note": "XMRig solo/daemon requires WITH_HTTP=ON per upstream CMake docs."
    },
    "hwloc": {
      "declared": hwloc_decl,
      "selftest": "n/a",
      "deviceVerified": False,
      "note": "No Android hwloc package in this build; topology remains limited."
    },
    "algorithms": {
      "declared": ["rx/0"],
      "selftest": "pending",
      "deviceVerified": False
    },
    "cpuBackend": {
      "declared": True,
      "selftest": "pending",
      "deviceVerified": False
    },
    "effectiveReadback": {
      "declared": http_decl,
      "selftest": os.environ["GEN_ST_HTTP"],
      "deviceVerified": False,
      "via": "httpApi" if http_decl else "process-relaunch"
    }
  },
  "uiGates": {
    "tlsToggle": tls_decl,
    "httpHotApply": http_decl,
    "offlineBenchmark": bench_decl,
    "soloDaemon": daemon_decl
  }
}
out = os.environ["GEN_OUT"]
with open(out, "w", encoding="utf-8") as f:
    json.dump(doc, f, indent=2, sort_keys=False)
    f.write("\n")
print(f"Wrote {out}")
print(f"binary.sha256={doc['binary']['sha256']}")
print(f"httpApi.declared={doc['capabilities']['httpApi']['declared']}")
print(f"tls.declared={doc['capabilities']['tls']['declared']}")
print(f"benchmark.declared={doc['capabilities']['benchmark']['declared']}")
print(f"daemon.declared={doc['capabilities']['daemon']['declared']}")
PY
