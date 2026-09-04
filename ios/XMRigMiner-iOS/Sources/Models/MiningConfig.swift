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
    var threads: Int
    var cpuPriority: Int
    var donateLevel: Int

    init(pool: PoolConfig = PoolConfig(),
         threads: Int = 0,
         cpuPriority: Int = 2,
         donateLevel: Int = 1) {
        self.pool = pool
        self.threads = threads
        self.cpuPriority = cpuPriority
        self.donateLevel = donateLevel
    }

    /// Convert to XMRig JSON config format
    /// Supports Monero (rx/0), Wownero (rx/wow), DERO (astrobwt/v3)
    func toJSON() -> String? {
        var poolConfig: [String: Any] = [
            "url": pool.url,
            "user": pool.user,
            "pass": pool.pass,
            "tls": pool.tls,
            "keepalive": true
        ]

        // Add coin-specific configuration
        if let coin = pool.coin.xmrigCoin {
            poolConfig["coin"] = coin
        }

        // For non-Monero coins, explicitly set the algorithm
        if pool.coin != .monero {
            poolConfig["algo"] = pool.coin.algorithm
        }

        let config: [String: Any] = [
            "autosave": false,  // Disable autosave to prevent config reload during initialization
            "watch": false,     // Disable config file watching
            "cpu": [
                "enabled": true,
                "max-threads-hint": 5,  // Use only 1 thread on iOS to minimize memory
                "huge-pages": false,
                "hw-aes": true,
                "yield": true
            ],
            "randomx": [
                "mode": "light",  // Use light mode (256MB) instead of full mode (2GB) for iOS
                "1gb-pages": false,
                "rdmsr": false,
                "wrmsr": false,
                "cache_qos": false,
                "numa": false,
                "jit": true,    // Enable JIT - requires debug mode or JIT entitlement
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
}

// MARK: - Preset Pools

extension PoolConfig {
    // Monero (XMR) pools - Using non-TLS ports (XMRig built without TLS)
    static let supportXMR = PoolConfig(url: "pool.supportxmr.com:3333", tls: false, coin: .monero)
    static let moneroOcean = PoolConfig(url: "gulf.moneroocean.stream:10001", tls: false, coin: .monero)
    static let hashVault = PoolConfig(url: "pool.hashvault.pro:3333", tls: false, coin: .monero)
    static let twoMiners = PoolConfig(url: "xmr.2miners.com:2222", tls: false, coin: .monero)

    // Wownero (WOW) pools
    static let heroMinersWOW = PoolConfig(url: "wownero.herominers.com:1111", tls: false, coin: .wownero)
    static let moneroOceanWOW = PoolConfig(url: "gulf.moneroocean.stream:10001", tls: false, coin: .wownero)

    // DERO pools/nodes
    static let deroOfficial = PoolConfig(url: "minernode1.dero.io:10100", tls: false, coin: .dero)
    static let deroCommunity = PoolConfig(url: "dero-node.mysrv.cloud:10100", tls: false, coin: .dero)

    /// Get all pools for a specific coin type
    static func pools(for coin: CoinType) -> [(String, PoolConfig)] {
        switch coin {
        case .monero:
            return [
                ("SupportXMR", supportXMR),
                ("MoneroOcean", moneroOcean),
                ("HashVault", hashVault),
                ("2Miners", twoMiners)
            ]
        case .wownero:
            return [
                ("HeroMiners WOW", heroMinersWOW),
                ("MoneroOcean WOW", moneroOceanWOW)
            ]
        case .dero:
            return [
                ("DERO Official", deroOfficial),
                ("DERO Community", deroCommunity)
            ]
        }
    }
}
