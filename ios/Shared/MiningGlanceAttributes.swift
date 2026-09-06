import ActivityKit
import Foundation

/// Live Activity attributes (#78). Display-only — not a mining or polling host.
struct MiningGlanceAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var status: String
        var hashrateHs: Double
        var syncQuality: String
        var lastUpdatedAtMs: Double
        var sessionId: String?
    }

    var sourceDeviceId: String
}
