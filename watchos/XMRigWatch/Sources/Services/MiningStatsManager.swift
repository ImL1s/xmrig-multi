import Foundation
import WatchConnectivity
import Combine

/// Mining statistics data model
struct MiningStats {
    var isRunning: Bool = false
    var hashrate: Double = 0.0
    var sharesAccepted: Int = 0
    var sharesRejected: Int = 0
    var difficulty: Int = 0
    var uptime: Int = 0
    var coinType: String = "XMR"
    var poolName: String = ""
    var syncQuality: String = "offline"
    var syncLabel: String = "Offline — last numbers are not live"
    var lastSyncAtMs: TimeInterval? = nil
    var sessionId: String? = nil
    var sourceDeviceId: String? = nil
}

/// Manages mining statistics via WatchConnectivity (#62 companion UX).
class MiningStatsManager: NSObject, ObservableObject {
    @Published var stats = MiningStats()
    @Published var isConnected = false
    @Published var commandPending = false
    @Published var lastAckReason: String? = nil

    private var session: WCSession?
    private let staleAfterMs: TimeInterval = 45_000

    override init() {
        super.init()
        setupWatchConnectivity()
        startStaleTimer()
    }

    private func setupWatchConnectivity() {
        if WCSession.isSupported() {
            session = WCSession.default
            session?.delegate = self
            session?.activate()
        }
    }

    private func startStaleTimer() {
        Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            self?.reclassifySync()
        }
    }

    // MARK: - Commands

    func requestStart() {
        sendCommand("start")
    }

    func requestStop() {
        sendCommand("stop")
    }

    func requestStats() {
        sendMessage(["command": "getStats"])
    }

    private func sendCommand(_ type: String) {
        commandPending = true
        lastAckReason = nil
        let now = Date().timeIntervalSince1970 * 1000
        sendMessage([
            "command": type,
            "commandId": "watch-\(Int(now))",
            "targetDeviceId": "phone",
            "sessionId": stats.sessionId as Any,
            "issuedAtMs": now,
            "expiresAtMs": now + 60_000
        ])
    }

    private func sendMessage(_ message: [String: Any]) {
        guard let session = session, session.isReachable else {
            isConnected = false
            commandPending = false
            lastAckReason = "Phone unreachable — stop not guaranteed"
            applySync(quality: "offline", label: "Offline — command not delivered", showLive: false)
            return
        }

        session.sendMessage(message, replyHandler: { [weak self] response in
            DispatchQueue.main.async {
                self?.handleResponse(response)
            }
        }, errorHandler: { [weak self] error in
            DispatchQueue.main.async {
                self?.isConnected = false
                self?.commandPending = false
                self?.lastAckReason = error.localizedDescription
                print("WatchConnectivity error: \(error)")
            }
        })
    }

    private func handleResponse(_ response: [String: Any]) {
        isConnected = true
        if let ack = response["ack"] as? String {
            commandPending = false
            lastAckReason = response["reason"] as? String
            if ack == "rejected" || ack == "expired" || ack == "undelivered" {
                return
            }
        }
        if let statsData = response["stats"] as? [String: Any] {
            updateStats(from: statsData)
        }
    }

    private func updateStats(from data: [String: Any]) {
        let syncAt = (data["syncAt"] as? Double)
            ?? (data["lastSyncAtMs"] as? Double)
            ?? (Date().timeIntervalSince1970 * 1000)
        stats.lastSyncAtMs = syncAt
        stats.sessionId = data["sessionId"] as? String
        stats.sourceDeviceId = data["sourceDeviceId"] as? String ?? "iphone"
        stats.hashrate = data["hashrate"] as? Double ?? 0.0
        stats.sharesAccepted = data["sharesAccepted"] as? Int ?? 0
        stats.sharesRejected = data["sharesRejected"] as? Int ?? 0
        stats.difficulty = data["difficulty"] as? Int ?? 0
        stats.uptime = data["uptime"] as? Int ?? 0
        stats.coinType = data["coinType"] as? String ?? "XMR"
        stats.poolName = data["poolName"] as? String ?? ""
        let running = data["isRunning"] as? Bool ?? false
        reclassifySync(runningHint: running)
        MiningSnapshotStore.save(
            hashrate: stats.hashrate,
            isRunning: stats.isRunning,
            syncQuality: stats.syncQuality,
            lastSyncAtMs: stats.lastSyncAtMs
        )
    }

    private func reclassifySync(runningHint: Bool? = nil) {
        let connected = isConnected && (session?.isReachable ?? false)
        guard let last = stats.lastSyncAtMs, connected else {
            applySync(quality: "offline", label: "Offline — last numbers are not live", showLive: false)
            return
        }
        let age = Date().timeIntervalSince1970 * 1000 - last
        if age > staleAfterMs {
            applySync(quality: "stale", label: "Stale (\(Int(age / 1000))s ago)", showLive: false)
            return
        }
        let running = runningHint ?? stats.isRunning
        stats.syncQuality = "live"
        stats.syncLabel = "Live"
        stats.isRunning = running
    }

    private func applySync(quality: String, label: String, showLive: Bool) {
        stats.syncQuality = quality
        stats.syncLabel = label
        if !showLive {
            stats.isRunning = false
        }
    }
}

// MARK: - WCSessionDelegate

extension MiningStatsManager: WCSessionDelegate {
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async {
            self.isConnected = activationState == .activated && session.isReachable
            if self.isConnected {
                self.requestStats()
            } else {
                self.applySync(quality: "offline", label: "Offline — last numbers are not live", showLive: false)
            }
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isConnected = session.isReachable
            if session.isReachable {
                self.requestStats()
            } else {
                self.applySync(quality: "offline", label: "Offline — last numbers are not live", showLive: false)
            }
        }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        DispatchQueue.main.async {
            self.handleResponse(message)
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        DispatchQueue.main.async {
            if let statsData = applicationContext["stats"] as? [String: Any] {
                self.updateStats(from: statsData)
            }
        }
    }
}
