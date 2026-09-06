import Foundation
import WidgetKit

enum MiningSnapshotStore {
    static let suiteName = "group.com.iml1s.xmrigminer"
    private static let hashrateKey = "hashrate"
    private static let runningKey = "isRunning"
    private static let syncQualityKey = "syncQuality"
    private static let lastSyncKey = "lastSyncAtMs"

    static func save(
        hashrate: Double,
        isRunning: Bool,
        syncQuality: String = "offline",
        lastSyncAtMs: TimeInterval? = nil
    ) {
        let defaults = UserDefaults(suiteName: suiteName)
        defaults?.set(hashrate, forKey: hashrateKey)
        defaults?.set(isRunning, forKey: runningKey)
        defaults?.set(syncQuality, forKey: syncQualityKey)
        if let lastSyncAtMs {
            defaults?.set(lastSyncAtMs, forKey: lastSyncKey)
        }
        WidgetCenter.shared.reloadAllTimelines()
    }

    static func load() -> (hashrate: Double, isRunning: Bool, syncQuality: String) {
        let defaults = UserDefaults(suiteName: suiteName)
        return (
            defaults?.double(forKey: hashrateKey) ?? 0,
            defaults?.bool(forKey: runningKey) ?? false,
            defaults?.string(forKey: syncQualityKey) ?? "offline"
        )
    }
}
