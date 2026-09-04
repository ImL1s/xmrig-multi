import Foundation
import Combine
import UIKit

struct MiningStats: Equatable {
    var hashrate10s: Double = 0
    var hashrate60s: Double = 0
    var hashrate15m: Double = 0
    var totalHashes: UInt64 = 0
    var acceptedShares: UInt64 = 0
    var rejectedShares: UInt64 = 0
    var isMining: Bool = false
    var threads: Int = 0
}

@MainActor
class XMRigWrapper: ObservableObject {
    
    @Published private(set) var stats = MiningStats()
    @Published private(set) var isRunning = false
    @Published private(set) var version: String = "6.25.0"
    @Published private(set) var logs: [String] = []
    
    private var statsTimer: Timer?
    private let bridge: XMRigBridge
    private let maxLogLines = 1000
    private let watchCoordinator = WatchSessionCoordinator()
    
    init() {
        bridge = XMRigBridge.shared()
        version = bridge.getVersion()
        
        if let cachesPath = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.path {
            bridge.setStoragePath(cachesPath)
        }
        
        setupLogCallback()
        watchCoordinator.bind(miner: self)
    }
    
    func initialize(config: MiningConfig) -> Bool {
        guard let jsonConfig = config.toJSON() else { return false }
        return bridge.initialize(withConfig: jsonConfig)
    }
    
    func start() {
        guard bridge.startMining() else { return }
        isRunning = true
        startStatsTimer()
        watchCoordinator.pushStats()
    }
    
    func stop() {
        bridge.stopMining()
        isRunning = false
        stopStatsTimer()
        watchCoordinator.pushStats()
    }
    
    func setThreads(_ count: Int) {
        bridge.setThreads(Int32(count))
    }
    
    func cleanup() {
        stop()
        bridge.cleanup()
        logs.removeAll()
    }
    
    func clearLogs() {
        logs.removeAll()
    }
    
    private func setupLogCallback() {
        bridge.logCallback = { [weak self] line in
            Task { @MainActor in
                self?.handleLogLine(line)
            }
        }
    }
    
    private func handleLogLine(_ line: String) {
        logs.append(line)
        if logs.count > maxLogLines {
            logs.removeFirst()
        }
        bridge.updateStats(fromLogLine: line)
    }
    
    private func startStatsTimer() {
        statsTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.updateStats()
            }
        }
    }

    private func stopStatsTimer() {
        statsTimer?.invalidate()
        statsTimer = nil
    }
    
    private func updateStats() {
        guard let statsDict = bridge.getStats() as? [String: Any] else { return }
        
        let newStats = MiningStats(
            hashrate10s: statsDict["hashrate_10s"] as? Double ?? 0,
            hashrate60s: statsDict["hashrate_60s"] as? Double ?? 0,
            hashrate15m: statsDict["hashrate_15m"] as? Double ?? 0,
            totalHashes: statsDict["total_hashes"] as? UInt64 ?? 0,
            acceptedShares: statsDict["accepted_shares"] as? UInt64 ?? 0,
            rejectedShares: statsDict["rejected_shares"] as? UInt64 ?? 0,
            isMining: statsDict["is_mining"] as? Bool ?? false,
            threads: statsDict["threads"] as? Int ?? 0
        )
        
        if newStats != stats {
            stats = newStats
            watchCoordinator.pushStats()
        }
        
        isRunning = newStats.isMining
    }
}
