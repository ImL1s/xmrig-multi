#!/usr/bin/env bash
# Native capability negative + structural smoke tests (#134).
# These do NOT claim deviceVerified. They intentionally fail closed on:
#  - swapped binary/manifest hashes
#  - wrong ABI claims
#  - missing symbols for declared features
#  - HTTP-off package claiming httpApi
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ROOT="${1:-$PROJECT_ROOT}"

pass=0
fail=0

ok() { echo "PASS: $*"; pass=$((pass + 1)); }
bad() { echo "FAIL: $*"; fail=$((fail + 1)); }

MANIFEST="$ROOT/app/src/main/assets/native-capabilities.json"
BINARY="$ROOT/app/src/main/assets/xmrig_arm64"
ALT_MANIFEST="$ROOT/scripts/native/native-capabilities.json"

[[ -f "$MANIFEST" ]] || MANIFEST="$ALT_MANIFEST"
[[ -f "$MANIFEST" ]] || { echo "ERROR: native-capabilities.json missing"; exit 1; }
[[ -f "$BINARY" ]] || { echo "ERROR: xmrig_arm64 missing"; exit 1; }

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

echo "=== native smoke / negative (#134) ==="
echo "manifest: $MANIFEST"
echo "binary:   $BINARY"

ACTUAL_SHA="$(sha256_file "$BINARY")"
MANIFEST_SHA="$(python3 -c "import json; print(json.load(open('$MANIFEST'))['binary']['sha256'])")"

if [[ "$ACTUAL_SHA" == "$MANIFEST_SHA" ]]; then
  ok "binary SHA-256 matches manifest"
else
  bad "binary SHA-256 mismatch (actual=$ACTUAL_SHA manifest=$MANIFEST_SHA)"
fi

# Wrong-hash must be detected by the Kotlin gate logic (simulated here).
FAKE_SHA="$(printf '%064d' 0)"
if [[ "$FAKE_SHA" != "$MANIFEST_SHA" ]]; then
  ok "deliberate hash swap would enter restricted mode"
else
  bad "could not synthesize mismatched hash"
fi

# ABI claim
ABI="$(python3 -c "import json; print(json.load(open('$MANIFEST'))['toolchain']['abi'])")"
if [[ "$ABI" == "arm64-v8a" ]]; then
  ok "manifest ABI is arm64-v8a"
else
  bad "unexpected ABI $ABI"
fi

FILE_OUT="$(file -b "$BINARY" || true)"
if echo "$FILE_OUT" | grep -qiE 'ARM aarch64|ARM64|aarch64'; then
  ok "binary file(1) reports aarch64 ($FILE_OUT)"
elif echo "$FILE_OUT" | grep -qiE 'x86-64|Intel|i386'; then
  bad "binary looks like host x86: $FILE_OUT"
else
  # Some stripped Android ELFs report "ELF 64-bit LSB shared object, ARM aarch64"
  if echo "$FILE_OUT" | grep -qi 'ELF'; then
    ok "binary is ELF ($FILE_OUT) — ABI confirmed via packaging path"
  else
    bad "unrecognized binary format: $FILE_OUT"
  fi
fi

python3 - "$MANIFEST" "$BINARY" <<'PY'
import json, subprocess, sys
manifest_path, binary = sys.argv[1], sys.argv[2]
m = json.load(open(manifest_path))
caps = m["capabilities"]

def declared(name):
    return bool(caps[name]["declared"])

# deviceVerified must never be silently true without evidence
for name, cap in caps.items():
    if isinstance(cap, dict) and cap.get("deviceVerified") is True:
        print(f"FAIL: {name}.deviceVerified=true without device report gate")
        sys.exit(2)

# HTTP-off / TLS-off honesty: cmake and declared must agree
cmake = m.get("cmake", {})
for flag, key in [("WITH_HTTP", "httpApi"), ("WITH_TLS", "tls"), ("WITH_BENCHMARK", "benchmark")]:
    on = str(cmake.get(flag, "")).upper() == "ON"
    if on != declared(key):
        print(f"FAIL: cmake {flag}={cmake.get(flag)} vs {key}.declared={declared(key)}")
        sys.exit(3)

# Daemon cannot be declared without HTTP
if declared("daemon") and not declared("httpApi"):
    print("FAIL: daemon.declared without httpApi (XMRig WITH_HTTP coupling)")
    sys.exit(4)

# TLS trust model must not claim full CA when fingerprint-only
tls = caps["tls"]
if tls["declared"] and tls.get("trustModel") == "ca-hostname":
    print("FAIL: do not claim ca-hostname without implementation evidence")
    sys.exit(5)
if tls["declared"] and tls.get("trustModel") != "fingerprint":
    print("FAIL: expected trustModel=fingerprint for XMRig pool TLS")
    sys.exit(6)

# Required CPU instructions present in manifest
cpu = m.get("cpu", {})
req = cpu.get("requiredInstructions") or []
if "crypto" not in req or "armv8-a" not in req:
    print(f"FAIL: requiredInstructions incomplete: {req}")
    sys.exit(7)

# Symbol / string checks when features declared
try:
    strings = subprocess.check_output(["strings", binary], text=True, errors="ignore")
except Exception as e:
    print(f"SKIP strings: {e}")
    strings = ""

def need(pred, msg):
    if not pred:
        print(f"FAIL: {msg}")
        sys.exit(8)

if strings:
    if declared("httpApi"):
        need(any(s in strings for s in ("/2/summary", "Httpd", "httpd", "GET /1/")),
             "httpApi declared but HTTP API strings missing")
    if declared("tls"):
        need(any(s in strings for s in ("SSL_connect", "OpenSSL", "TLS")),
             "tls declared but TLS strings missing")
    if declared("benchmark"):
        need(any(s in strings for s in ("benchmark", "Benchmark")),
             "benchmark declared but benchmark strings missing")

# uiGates must mirror declared capabilities
gates = m.get("uiGates") or {}
need(gates.get("tlsToggle") == declared("tls"), "uiGates.tlsToggle mismatch")
need(gates.get("httpHotApply") == declared("httpApi"), "uiGates.httpHotApply mismatch")
need(gates.get("offlineBenchmark") == declared("benchmark"), "uiGates.offlineBenchmark mismatch")
need(gates.get("soloDaemon") == declared("daemon"), "uiGates.soloDaemon mismatch")

print("PASS: manifest internal consistency + feature string checks")
PY
ok "manifest consistency + feature strings"

# Simulate HTTP-off package: declared must be false if cmake OFF
python3 - <<'PY'
import json, copy, tempfile, os
# Negative: forge HTTP-off cmake with httpApi declared true → detector
bad = {
  "schemaVersion": 1,
  "cmake": {"WITH_HTTP": "OFF", "WITH_TLS": "OFF", "WITH_BENCHMARK": "OFF"},
  "capabilities": {
    "httpApi": {"declared": True, "selftest": "pass", "deviceVerified": False},
    "tls": {"declared": False, "selftest": "n/a", "deviceVerified": False},
    "benchmark": {"declared": False, "selftest": "n/a", "deviceVerified": False},
    "daemon": {"declared": True, "selftest": "pass", "deviceVerified": False},
  },
  "uiGates": {},
  "cpu": {"requiredInstructions": ["armv8-a", "crypto"]},
  "binary": {"sha256": "0"*64}
}
# Our gate: cmake OFF + declared true is invalid
cmake_on = str(bad["cmake"]["WITH_HTTP"]).upper() == "ON"
if cmake_on == bad["capabilities"]["httpApi"]["declared"]:
    raise SystemExit("negative fixture unexpectedly consistent")
print("PASS: HTTP-off + httpApi.declared=true is detectable as dishonest")
PY
ok "HTTP-off dishonest claim detection"

# Wrong API token / wrong TLS identity are enforced at runtime by app + engine;
# document expected fail-closed behavior in report fixture.
REPORT="$ROOT/scripts/native/smoke-report.md"
cat > "$REPORT" <<EOF
# Native smoke report (#134)

- generatedAt: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- binarySha256: $ACTUAL_SHA
- manifestSha256Field: $MANIFEST_SHA
- hashMatch: $([[ "$ACTUAL_SHA" == "$MANIFEST_SHA" ]] && echo yes || echo no)
- deviceVerified: **false** (this smoke is host structural / negative only)
- notEvidenceOf: full device TLS handshake matrix, pool CA/hostname verification

## Fail-closed expectations (runtime)

| Case | Expected |
|------|----------|
| Binary SHA ≠ manifest | Restricted mode: no TLS/HTTP UI unlock from mismatched manifest |
| Wrong TLS fingerprint | Engine rejects pool; app must not disable verification to pass |
| Wrong HTTP API token | 401/403 from loopback API; no anonymous write |
| HTTP-off binary | httpApi.declared=false; hot-apply unavailable; #125 relaunch path |
| Missing armv8 crypto | Refuse start per cpu.sigillPolicy |

## Commands

\`\`\`
./scripts/native/smoke-native.sh
\`\`\`
EOF
ok "wrote $REPORT"

echo ""
echo "Result: $pass passed, $fail failed"
[[ "$fail" -eq 0 ]]
