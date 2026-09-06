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
        if snap.clockOnly {
            return ("Clock", nil, false)
        }
        let live = snap.syncQuality == "live"
        let statusTitle: String = {
            switch snap.status {
            case "mining": return "Mining"
            case "paused": return "Paused"
            case "waiting": return "Waiting"
            default: return "Stopped"
            }
        }()
        let title = live ? statusTitle : "\(statusTitle) · snapshot"
        let hs: String? = {
            if snap.syncQuality == "offline" && snap.lastUpdatedAtMs <= 0 { return nil }
            if !live && snap.hashrateHs <= 0 { return nil }
            let value = String(format: "%.1f H/s", snap.hashrateHs)
            return live ? value : "\(value) (not live)"
        }()
        return (title, hs, live)
    }

    static func nextMinuteAlignedDate(from date: Date = Date()) -> Date {
        let ms = date.timeIntervalSince1970 * 1000
        let delay = 60_000 - ms.truncatingRemainder(dividingBy: 60_000)
        return date.addingTimeInterval(delay / 1000.0)
    }
}
