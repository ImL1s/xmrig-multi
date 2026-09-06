# Artifact smoke (#64)

Inspect built artifacts (Web `dist`, optional APK/desktop paths) for capability markers.
Does **not** mine on public pools.

```bash
node shared/artifact-smoke/js/smoke.js --web-dist web/dist
node --test shared/artifact-smoke/test/*.test.js
```
