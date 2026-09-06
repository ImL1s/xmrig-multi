import ActivityKit
import Foundation

/// Starts/updates Live Activities from App Group snapshots (#78 / #132).
/// Does not poll pools or run RandomX.
@MainActor
enum GlanceLiveActivityController {
    /// Monotonic revision so late Tasks cannot revive an ended / superseded session.
    private static var operationRevision: UInt64 = 0
    private static var endedSessionIds = Set<String>()

    static func sync(from snap: GlanceSnapshotStore.Snapshot) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let revision = operationRevision &+ 1
        operationRevision = revision

        let state = MiningGlanceAttributes.ContentState(
            status: snap.status,
            hashrateHs: snap.hashrateHs,
            syncQuality: snap.syncQuality,
            lastUpdatedAtMs: snap.lastUpdatedAtMs,
            sessionId: snap.sessionId
        )

        if let sid = snap.sessionId, endedSessionIds.contains(sid) {
            if snap.status == "mining" || snap.status == "paused" {
                endedSessionIds.remove(sid)
            } else {
                return
            }
        }

        let existing = Activity<MiningGlanceAttributes>.activities
        if let activity = existing.first {
            Task {
                // Drop stale async work after a newer sync/end.
                guard revision == operationRevision else { return }
                await activity.update(ActivityContent(state: state, staleDate: staleDate(for: snap)))
                guard revision == operationRevision else { return }
                if snap.status == "stopped" || snap.syncQuality == "offline" {
                    if let sid = snap.sessionId {
                        endedSessionIds.insert(sid)
                    }
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

    /// Product TTL for ActivityKit staleDate — OS flips `context.isStale` after this (#132).
    private static func staleDate(for snap: GlanceSnapshotStore.Snapshot) -> Date {
        Date(timeIntervalSince1970: (snap.lastUpdatedAtMs / 1000.0) + GlancePresentation.liveActivityTtlSeconds)
    }
}
