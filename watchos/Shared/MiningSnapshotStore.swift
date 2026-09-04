import Foundation
import WidgetKit

enum MiningSnapshotStore {
    static let suiteName = "group.com.iml1s.xmrigminer"
    private static let hashrateKey = "hashrate"
    private static let runningKey = "isRunning"

    static func save(hashrate: Double, isRunning: Bool) {
        let defaults = UserDefaults(suiteName: suiteName)
        defaults?.set(hashrate, forKey: hashrateKey)
        defaults?.set(isRunning, forKey: runningKey)
        WidgetCenter.shared.reloadAllTimelines()
    }

    static func load() -> (hashrate: Double, isRunning: Bool) {
        let defaults = UserDefaults(suiteName: suiteName)
        return (
            defaults?.double(forKey: hashrateKey) ?? 0,
            defaults?.bool(forKey: runningKey) ?? false
        )
    }
}
