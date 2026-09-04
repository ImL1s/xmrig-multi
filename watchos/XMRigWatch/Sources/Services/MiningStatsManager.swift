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
}

/// Manages mining statistics via WatchConnectivity
/// Communicates with iPhone app to get stats and send commands
class MiningStatsManager: NSObject, ObservableObject {
    @Published var stats = MiningStats()
    @Published var isConnected = false

    private var session: WCSession?

    override init() {
        super.init()
        setupWatchConnectivity()
    }

    private func setupWatchConnectivity() {
        if WCSession.isSupported() {
            session = WCSession.default
            session?.delegate = self
            session?.activate()
        }
    }

    // MARK: - Commands

    func requestStart() {
        sendMessage(["command": "start"])
    }

    func requestStop() {
        sendMessage(["command": "stop"])
    }

    func requestStats() {
        sendMessage(["command": "getStats"])
    }

    private func sendMessage(_ message: [String: Any]) {
        guard let session = session, session.isReachable else {
            isConnected = false
            return
        }

        session.sendMessage(message, replyHandler: { [weak self] response in
            DispatchQueue.main.async {
                self?.handleResponse(response)
            }
        }, errorHandler: { [weak self] error in
            DispatchQueue.main.async {
                self?.isConnected = false
                print("WatchConnectivity error: \(error)")
            }
        })
    }

    private func handleResponse(_ response: [String: Any]) {
        isConnected = true

        if let statsData = response["stats"] as? [String: Any] {
            updateStats(from: statsData)
        }
    }

    private func updateStats(from data: [String: Any]) {
        stats.isRunning = data["isRunning"] as? Bool ?? false
        stats.hashrate = data["hashrate"] as? Double ?? 0.0
        stats.sharesAccepted = data["sharesAccepted"] as? Int ?? 0
        stats.sharesRejected = data["sharesRejected"] as? Int ?? 0
        stats.difficulty = data["difficulty"] as? Int ?? 0
        stats.uptime = data["uptime"] as? Int ?? 0
        stats.coinType = data["coinType"] as? String ?? "XMR"
        stats.poolName = data["poolName"] as? String ?? ""
        MiningSnapshotStore.save(hashrate: stats.hashrate, isRunning: stats.isRunning)
    }
}

// MARK: - WCSessionDelegate

extension MiningStatsManager: WCSessionDelegate {
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async {
            self.isConnected = activationState == .activated && session.isReachable
            if self.isConnected {
                self.requestStats()
            }
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isConnected = session.isReachable
            if session.isReachable {
                self.requestStats()
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
