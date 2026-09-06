import ActivityKit
import Foundation

/// Starts/updates Live Activities from App Group snapshots (#78).
/// Does not poll pools or run RandomX.
@MainActor
enum GlanceLiveActivityController {
    static func sync(from snap: GlanceSnapshotStore.Snapshot) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let state = MiningGlanceAttributes.ContentState(
            status: snap.status,
            hashrateHs: snap.hashrateHs,
            syncQuality: snap.syncQuality,
            lastUpdatedAtMs: snap.lastUpdatedAtMs,
            sessionId: snap.sessionId
        )
        let existing = Activity<MiningGlanceAttributes>.activities
        if let activity = existing.first {
            Task {
                await activity.update(ActivityContent(state: state, staleDate: staleDate(for: snap)))
                if snap.status == "stopped" || snap.syncQuality == "offline" {
                    await activity.end(nil, dismissalPolicy: .default)
                }
            }
            return
        }
        guard snap.status == "mining" || snap.status == "paused" else { return }
        let attrs = MiningGlanceAttributes(sourceDeviceId: snap.sourceDeviceId ?? "local")
        let content = ActivityContent(state: state, staleDate: staleDate(for: snap))
        _ = try? Activity.request(attributes: attrs, content: content, pushType: nil)
    }

    private static func staleDate(for snap: GlanceSnapshotStore.Snapshot) -> Date {
        Date(timeIntervalSince1970: (snap.lastUpdatedAtMs / 1000.0) + 90)
    }
}
