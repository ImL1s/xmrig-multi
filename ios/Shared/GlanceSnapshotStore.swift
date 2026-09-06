import Foundation
import WidgetKit

/// App Group glance snapshot for Widget / StandBy / Live Activity (#78).
/// Never stores wallet, seed, pool password, or API tokens.
enum GlanceSnapshotStore {
    static let suiteName = "group.com.iml1s.xmrigminer"
    /// Align with companion-sync default; force-quit cannot keep "live" for minutes.
    static let staleAfterMs: Double = 45_000
    static let liveHeartbeatMs: Double = 12_000

    private enum Key {
        static let status = "glance.status"
        static let hashrate = "glance.hashrateHs"
        static let lastUpdated = "glance.lastUpdatedAtMs"
        static let sessionId = "glance.sessionId"
        static let sourceDevice = "glance.sourceDeviceId"
        static let syncQuality = "glance.syncQuality"
        static let clockOnly = "glance.clockOnly"
        static let todayKwh = "glance.todayKwh"
        static let todayCost = "glance.todayCostFiat"
        static let lastWidgetReload = "glance.lastWidgetReloadAtMs"
    }

    struct Snapshot: Equatable {
        var status: String
        var hashrateHs: Double
        var lastUpdatedAtMs: Double
        var sessionId: String?
        var sourceDeviceId: String?
        var syncQuality: String
        var clockOnly: Bool
        var todayKwh: Double?
        var todayCostFiat: Double?
    }

    static func save(_ snap: Snapshot, reloadWidgets: Bool = false) {
        let defaults = UserDefaults(suiteName: suiteName)
        defaults?.set(snap.status, forKey: Key.status)
        defaults?.set(snap.hashrateHs, forKey: Key.hashrate)
        defaults?.set(snap.lastUpdatedAtMs, forKey: Key.lastUpdated)
        defaults?.set(snap.sessionId, forKey: Key.sessionId)
        defaults?.set(snap.sourceDeviceId, forKey: Key.sourceDevice)
        defaults?.set(snap.syncQuality, forKey: Key.syncQuality)
        defaults?.set(snap.clockOnly, forKey: Key.clockOnly)
        if let kwh = snap.todayKwh {
            defaults?.set(kwh, forKey: Key.todayKwh)
        } else {
            defaults?.removeObject(forKey: Key.todayKwh)
        }
        if let cost = snap.todayCostFiat {
            defaults?.set(cost, forKey: Key.todayCost)
        } else {
            defaults?.removeObject(forKey: Key.todayCost)
        }
        if reloadWidgets {
            reloadWidgetsThrottled(nowMs: snap.lastUpdatedAtMs)
        }
    }

    /// WidgetKit reload at most ~once per minute (start/stop always allowed via force).
    static func reloadWidgetsThrottled(nowMs: Double, force: Bool = false) {
        let defaults = UserDefaults(suiteName: suiteName)
        let last = defaults?.double(forKey: Key.lastWidgetReload) ?? 0
        if !force && last > 0 && (nowMs - last) < 55_000 {
            return
        }
        defaults?.set(nowMs, forKey: Key.lastWidgetReload)
        WidgetCenter.shared.reloadAllTimelines()
    }

    static func load() -> Snapshot {
        let defaults = UserDefaults(suiteName: suiteName)
        let last = defaults?.double(forKey: Key.lastUpdated) ?? 0
        let nowMs = Date().timeIntervalSince1970 * 1000
        let ageMs = last > 0 ? nowMs - last : Double.greatestFiniteMagnitude
        let storedQuality = defaults?.string(forKey: Key.syncQuality) ?? "offline"
        let quality: String
        if last <= 0 {
            quality = "offline"
        } else if ageMs > staleAfterMs {
            quality = "offline"
        } else if storedQuality == "live" && ageMs > liveHeartbeatMs {
            // Process likely dead — do not keep advertising live mining.
            quality = "stale"
        } else if ageMs > liveHeartbeatMs {
            quality = "stale"
        } else {
            quality = storedQuality
        }
        return Snapshot(
            status: defaults?.string(forKey: Key.status) ?? "stopped",
            hashrateHs: defaults?.double(forKey: Key.hashrate) ?? 0,
            lastUpdatedAtMs: last,
            sessionId: defaults?.string(forKey: Key.sessionId),
            sourceDeviceId: defaults?.string(forKey: Key.sourceDevice),
            syncQuality: quality,
            clockOnly: defaults?.bool(forKey: Key.clockOnly) ?? false,
            todayKwh: defaults?.object(forKey: Key.todayKwh) as? Double,
            todayCostFiat: defaults?.object(forKey: Key.todayCost) as? Double
        )
    }

    /// Human label — never claims live when stale/offline.
    static func presentation(for snap: Snapshot) -> (title: String, hashrate: String?, live: Bool) {
        let view = GlancePresentation.make(
            status: snap.status,
            hashrateHs: snap.hashrateHs,
            syncQuality: snap.syncQuality,
            lastUpdatedAtMs: snap.lastUpdatedAtMs,
            sessionId: snap.sessionId,
            osIsStale: false,
            now: Date(),
            clockOnly: snap.clockOnly,
            liveActivityTtlSeconds: staleAfterMs / 1000.0
        )
        return (view.title, view.hashrateText, view.isLive)
    }

    static func nextMinuteAlignedDate(from date: Date = Date()) -> Date {
        let ms = date.timeIntervalSince1970 * 1000
        let delay = 60_000 - ms.truncatingRemainder(dividingBy: 60_000)
        return date.addingTimeInterval(delay / 1000.0)
    }
}

/// Shared Live Activity / glance freshness presenter (#132).
/// `syncQuality == "live"` alone is never enough — OS `isStale` and TTL must agree.
enum GlancePresentation {
    /// Live Activity staleDate offset used by GlanceLiveActivityController.
    static let liveActivityTtlSeconds: TimeInterval = 90

    struct ViewData: Equatable {
        var title: String
        var qualityLabel: String
        var hashrateText: String?
        var compactHashrate: String
        var iconSystemName: String
        var isLive: Bool
        var accessibilityText: String
    }

    static func make(
        status: String,
        hashrateHs: Double,
        syncQuality: String,
        lastUpdatedAtMs: Double,
        sessionId: String?,
        osIsStale: Bool,
        now: Date = Date(),
        clockOnly: Bool = false,
        expectedSessionId: String? = nil,
        liveActivityTtlSeconds: TimeInterval = liveActivityTtlSeconds
    ) -> ViewData {
        if clockOnly {
            return ViewData(
                title: "Clock",
                qualityLabel: "CLOCK",
                hashrateText: nil,
                compactHashrate: "—",
                iconSystemName: "clock",
                isLive: false,
                accessibilityText: "Clock only — not mining"
            )
        }

        let sessionOk: Bool = {
            guard let expected = expectedSessionId, !expected.isEmpty else { return true }
            return sessionId == expected
        }()

        let ageSeconds: Double? = {
            guard lastUpdatedAtMs > 0 else { return nil }
            let sample = lastUpdatedAtMs / 1000.0
            let nowSec = now.timeIntervalSince1970
            if sample > nowSec + 5 {
                // Future timestamp — conservative: treat as not live.
                return Double.greatestFiniteMagnitude
            }
            return nowSec - sample
        }()

        let withinTtl = ageSeconds.map { $0 >= 0 && $0 < liveActivityTtlSeconds } ?? false
        let qualityLive = syncQuality == "live"
        let isLive = !osIsStale && qualityLive && withinTtl && sessionOk

        let base: String = {
            switch status {
            case "mining": return "Mining"
            case "paused": return "Paused"
            case "waiting": return "Waiting"
            default: return "Stopped"
            }
        }()

        let title: String
        let qualityLabel: String
        if osIsStale {
            title = "\(base) · stale"
            qualityLabel = "STALE"
        } else if isLive {
            title = base
            qualityLabel = "LIVE"
        } else if syncQuality == "offline" {
            title = "\(base) · offline"
            qualityLabel = "OFFLINE"
        } else {
            title = "\(base) · snapshot"
            qualityLabel = syncQuality.uppercased()
        }

        let hashrateText: String?
        let compact: String
        if syncQuality == "offline" && lastUpdatedAtMs <= 0 {
            hashrateText = nil
            compact = "—"
        } else if isLive {
            hashrateText = String(format: "%.1f H/s", hashrateHs)
            compact = String(format: "%.0f", hashrateHs)
        } else if hashrateHs > 0 {
            hashrateText = String(format: "%.1f H/s (not live)", hashrateHs)
            compact = "—"
        } else {
            hashrateText = nil
            compact = "—"
        }

        return ViewData(
            title: title,
            qualityLabel: qualityLabel,
            hashrateText: hashrateText,
            compactHashrate: compact,
            iconSystemName: isLive ? "bolt.fill" : "bolt.slash",
            isLive: isLive,
            accessibilityText: "\(title), \(hashrateText ?? "no hashrate"), \(qualityLabel)"
        )
    }

    static func make(
        state: MiningGlanceAttributes.ContentState,
        osIsStale: Bool,
        now: Date = Date(),
        expectedSessionId: String? = nil
    ) -> ViewData {
        make(
            status: state.status,
            hashrateHs: state.hashrateHs,
            syncQuality: state.syncQuality,
            lastUpdatedAtMs: state.lastUpdatedAtMs,
            sessionId: state.sessionId,
            osIsStale: osIsStale,
            now: now,
            expectedSessionId: expectedSessionId
        )
    }
}
