import Foundation
import WatchConnectivity

/// Bridges iPhone mining state to the watchOS companion via WatchConnectivity.
final class WatchSessionCoordinator: NSObject, WCSessionDelegate {
    private weak var miner: XMRigWrapper?
    private var session: WCSession?

    func bind(miner: XMRigWrapper) {
        self.miner = miner
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
        self.session = session
    }

    func pushStats() {
        guard let session, session.activationState == .activated else { return }
        let payload = currentStatsPayload()
        guard !payload.isEmpty else { return }
        try? session.updateApplicationContext(payload)
        if session.isReachable {
            session.sendMessage(payload, replyHandler: nil, errorHandler: nil)
        }
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        handle(message)
        replyHandler(currentStatsPayload())
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        handle(message)
    }

    private func handle(_ message: [String: Any]) {
        let command = message["command"] as? String
        DispatchQueue.main.async { [weak self] in
            guard let self, let miner = self.miner else { return }
            switch command {
            case "start":
                if !miner.isRunning, let config = MiningConfigStore.load(), !config.pool.user.isEmpty {
                    if miner.initialize(config: config) {
                        miner.start()
                    }
                }
            case "stop":
                miner.stop()
            default:
                break
            }
            self.pushStats()
        }
    }

    private func currentStatsPayload() -> [String: Any] {
        guard let miner else { return [:] }
        let config = MiningConfigStore.load()
        return [
            "stats": [
                "isRunning": miner.isRunning,
                "hashrate": miner.stats.hashrate10s,
                "sharesAccepted": Int(miner.stats.acceptedShares),
                "sharesRejected": Int(miner.stats.rejectedShares),
                "difficulty": Int(miner.stats.difficulty),
                "uptime": miner.uptimeSeconds,
                "coinType": watchCoinLabel(config?.pool.coin),
                "poolName": config?.pool.url ?? ""
            ]
        ]
    }

    private func watchCoinLabel(_ coin: CoinType?) -> String {
        switch coin {
        case .wownero: return "WOW"
        case .dero: return "DERO"
        default: return "XMR"
        }
    }
}
