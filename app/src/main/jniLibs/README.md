XMRig Android binaries belong here after `scripts/build_xmrig.sh`:

- `arm64-v8a/libxmrig.so`

The files themselves are gitignored. Without them the app still builds, but mining cannot start unless an asset fallback (`xmrig_arm64`) is present.
