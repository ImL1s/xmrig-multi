# watchOS companion

Stats viewer and remote start/stop for the iOS miner. It does not mine on-device (Apple policy).

## Generate the Xcode project

```bash
cd watchos
xcodegen generate
open XMRigWatch.xcodeproj
```

Pair it with the iOS app (`com.iml1s.xmrigminer`) which speaks WatchConnectivity in `WatchSessionCoordinator.swift`.
