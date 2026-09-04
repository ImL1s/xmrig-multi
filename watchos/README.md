# watchOS companion

Stats viewer and remote start/stop for the iOS miner. It does not mine on-device (Apple policy).

## Generate the Xcode project

```bash
cd watchos
xcodegen generate
open XMRigWatch.xcodeproj
```

`xcodegen` produces two targets:

- `XMRigWatch` — the watch app (`com.iml1s.xmrigminer.watchkitapp`)
- `XMRigWatchWidgets` — WidgetKit complications (`com.iml1s.xmrigminer.watchkitapp.widgets`)

The watch Info.plist sets `WKCompanionAppBundleIdentifier` to `com.iml1s.xmrigminer` (the iOS app). Do not set `WKWatchOnly`; this is a companion, not a standalone watch app. Pair it with the iOS app, which speaks WatchConnectivity in `WatchSessionCoordinator.swift`.

The watch app and widget extension share App Group `group.com.iml1s.xmrigminer` so complications can read the latest hashrate after `MiningStatsManager` updates.
