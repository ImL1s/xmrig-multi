//
//  MiningConfig.swift
//  XMRigMiner-iOS
//
//  Mining configuration model
//

import Foundation

/// Supported cryptocurrencies
enum CoinType: String, Codable, CaseIterable {
    case monero = "MONERO"
    case wownero = "WOWNERO"
    case dero = "DERO"

    var displayName: String {
        switch self {
        case .monero: return "Monero (XMR)"
        case .wownero: return "Wownero (WOW)"
        case .dero: return "DERO"
        }
    }

    var algorithm: String {
        switch self {
        case .monero: return "rx/0"
        case .wownero: return "rx/wow"
        case .dero: return "astrobwt/v3"
        }
    }

    var algorithmDisplay: String {
        switch self {
        case .monero: return "RandomX"
        case .wownero: return "RandomWOW"
        case .dero: return "AstroBWT/v3"
        }
    }

    var xmrigCoin: String? {
        switch self {
        case .monero: return "monero"
        case .wownero: return "wownero"
        case .dero: return "dero"
        }
    }

    var walletAddressPrefix: String {
        switch self {
        case .monero: return "4"
        case .wownero: return "Wo"
        case .dero: return "dero"
        }
    }

    var walletPlaceholder: String {
        switch self {
        case .monero: return "4..."
        case .wownero: return "Wo..."
        case .dero: return "dero..."
        }
    }

    var walletHint: String {
        switch self {
        case .monero: return "Monero address starts with 4 or 8"
        case .wownero: return "Wownero address starts with Wo"
        case .dero: return "DERO address starts with dero"
        }
    }

    func validateAddress(_ address: String) -> Bool {
        switch self {
        case .monero:
            return (address.hasPrefix("4") || address.hasPrefix("8")) && address.count >= 95
        case .wownero:
            return address.hasPrefix("Wo") && address.count >= 95
        case .dero:
            return address.hasPrefix("dero") && address.count >= 60
        }
    }
}

/// Mining pool configuration
struct PoolConfig: Codable {
    var url: String
    var user: String
    var pass: String
    var tls: Bool
    var coin: CoinType

    init(url: String = "gulf.moneroocean.stream:10001",
         user: String = "",
         pass: String = "x",
         tls: Bool = false,
         coin: CoinType = .monero) {
        self.url = url
        self.user = user
        self.pass = pass
        self.tls = tls
        self.coin = coin
    }
}

/// Complete mining configuration
struct MiningConfig: Codable {
    var pool: PoolConfig
    /// 0 = Auto (max-threads-hint only). >0 = requested thread count.
    var threads: Int
    /// XMRig cpu.priority (0–5). Values outside range are clamped on serialize.
    var cpuPriority: Int
    var donateLevel: Int

    /// Soft cap for iOS memory/thermal budget; users may request less.
    static let iosMaxRecommendedThreads = 2

    init(pool: PoolConfig = PoolConfig(),
         threads: Int = 1,
         cpuPriority: Int = 2,
         donateLevel: Int = 1) {
        self.pool = pool
        self.threads = threads
        self.cpuPriority = cpuPriority
        self.donateLevel = donateLevel
    }

    /// Effective threads written to JSON after platform budget.
    var resolvedThreads: Int {
        if threads <= 0 { return 0 } // Auto
        return min(threads, MiningConfig.iosMaxRecommendedThreads)
    }

    var usesAutoThreads: Bool { threads <= 0 }

    /// Convert to XMRig JSON config format
    func toJSON() -> String? {
        var poolConfig: [String: Any] = [
            "url": pool.url,
            "user": pool.user,
            "pass": pool.pass,
            "tls": pool.tls,
            "keepalive": true
        ]

        if let coin = pool.coin.xmrigCoin {
            poolConfig["coin"] = coin
        }

        if pool.coin != .monero {
            poolConfig["algo"] = pool.coin.algorithm
        }

        let priority = max(0, min(5, cpuPriority))
        let config: [String: Any] = [
            "autosave": false,
            "watch": false,
            "cpu": buildCpuConfig(priority: priority),
            "randomx": [
                "mode": "light",
                "1gb-pages": false,
                "rdmsr": false,
                "wrmsr": false,
                "cache_qos": false,
                "numa": false,
                "jit": true,
                "scratchpad_prefetch_mode": 1
            ],
            "donate-level": donateLevel,
            "pools": [poolConfig]
        ]

        guard let data = try? JSONSerialization.data(withJSONObject: config, options: .prettyPrinted),
              let jsonString = String(data: data, encoding: .utf8) else {
            return nil
        }

        return jsonString
    }

    private func buildCpuConfig(priority: Int) -> [String: Any] {
        var cpu: [String: Any] = [
            "enabled": true,
            "priority": priority,
            "huge-pages": false,
            "hw-aes": true,
            "yield": true
        ]
        if usesAutoThreads {
            // Conservative auto hint for iOS light mode.
            cpu["max-threads-hint"] = 5
        } else {
            let cores = max(1, ProcessInfo.processInfo.activeProcessorCount)
            let resolved = resolvedThreads
            let hint = max(1, min(100, Int((Double(resolved) / Double(cores) * 100.0).rounded())))
            cpu["max-threads-hint"] = hint
            // Explicit thread affinity list (-1 = any core); length = effective threads.
            cpu["rx/0"] = Array(repeating: -1, count: resolved)
        }
        return cpu
    }
}

// MARK: - Preset Pools

extension PoolConfig {
    // Monero (XMR) pools — ports aligned with shared/pool-registry (#40/#41).
    // XMRig iOS binary built without TLS: use non-TLS endpoints only.
    static let supportXMR = PoolConfig(url: "pool.supportxmr.com:3333", tls: false, coin: .monero)
    static let moneroOcean = PoolConfig(url: "gulf.moneroocean.stream:10128", tls: false, coin: .monero)
    static let hashVault = PoolConfig(url: "pool.hashvault.pro:3333", tls: false, coin: .monero)
    static let twoMiners = PoolConfig(url: "xmr.2miners.com:2222", tls: false, coin: .monero)

    // Wownero / DERO presets: kept only as unavailable markers until adapters exist (#27/#28).
    // MoneroOcean WOW removed — pool pays XMR, not WOW (#29).
    static let heroMinersWOW = PoolConfig(url: "wownero.herominers.com:1111", tls: false, coin: .wownero)
    static let deroOfficial = PoolConfig(url: "minernode1.dero.io:10100", tls: false, coin: .dero)
    static let deroCommunity = PoolConfig(url: "dero-node.mysrv.cloud:10100", tls: false, coin: .dero)

    /// Get all pools for a specific coin type
    static func pools(for coin: CoinType) -> [(String, PoolConfig)] {
        switch coin {
        case .monero:
            return [
                ("SupportXMR", supportXMR),
                ("MoneroOcean (XMR payout)", moneroOcean),
                ("HashVault", hashVault),
                ("2Miners", twoMiners)
            ]
        case .wownero:
            // Listed for migration visibility; start is gated in XMRigWrapper (#28).
            return [
                ("HeroMiners WOW (unavailable #28)", heroMinersWOW)
            ]
        case .dero:
            return [
                ("DERO Official (unavailable #27)", deroOfficial),
                ("DERO Community (unavailable #27)", deroCommunity)
            ]
        }
    }
}
