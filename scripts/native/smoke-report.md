# Native smoke report (#134)

- generatedAt: 2026-09-06T14:54:56Z
- binarySha256: 92b51088237adb4b4402e6598d6a603eb6fe163d33691ad93278869dd166fadc
- manifestSha256Field: 92b51088237adb4b4402e6598d6a603eb6fe163d33691ad93278869dd166fadc
- hashMatch: yes
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

```
./scripts/native/smoke-native.sh
```
