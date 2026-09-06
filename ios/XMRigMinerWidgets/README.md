# iOS StandBy / Widget / Live Activity glance (#78)

Source files live under `ios/XMRigMinerWidgets` + `ios/Shared`. Regenerate the
Xcode project on macOS after pull:

```bash
cd ios && xcodegen generate
```

## Support matrix (honest)

| Surface | Requirement | Notes |
|---------|-------------|--------|
| Home Widget | iOS 16+ | Timeline minute refresh — not continuous mining |
| Lock Screen accessory | iOS 16+ | Snapshot only |
| StandBy | iPhone iOS 17+, charging + landscape | Not claimed on iPad; screen may sleep |
| Live Activity | iOS 16.1+ | Display host only; no pool polling inside Activity |

## Privacy

App Group `group.com.iml1s.xmrigminer` stores status / hashrate / sync quality /
optional energy totals — never wallet, seed, or pool password.

## Device vs simulator

Widget/StandBy layout can be checked in Simulator; StandBy charging behavior and
real Live Activity push require a physical iPhone. Mark evidence accordingly.
