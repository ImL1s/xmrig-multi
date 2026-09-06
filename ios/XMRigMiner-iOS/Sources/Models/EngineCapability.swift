import Foundation

/// iOS engine capability gate (#60). Channel + binary evidence — not OS version alone.
struct EngineCapability: Equatable {
    enum Channel: String {
        case sideloadMiner = "sideload-miner"
        case sourceBuild = "source-build"
        case appStoreCompanion = "app-store-companion"
        case unverified = "unverified"
    }

    enum JitStatus: String {
        case verifiedOn = "verified-on"
        case verifiedOff = "verified-off-fallback-interpreter"
        case keyAcceptedUnverified = "key-accepted-unverified-runtime"
        case unsupported
        case unavailable
    }

    var channel: Channel
    var canMineOnDevice: Bool
    var miningBlockedReason: String?
    var randomxMode: String
    var jitEnabled: Bool
    var jitStatus: JitStatus
    var backgroundReliable: Bool
    var backgroundReason: String
    var binaryPresent: Bool
    var binaryVerified: Bool
    var warnings: [String]

    /// Default for sideload UI builds: binary assumed present but JIT runtime unverified → fail-closed jit:false.
    static func probeSideloadDefault(binaryPresent: Bool, version: String) -> EngineCapability {
        resolve(
            channel: .sideloadMiner,
            binaryPresent: binaryPresent,
            selftestPassed: binaryPresent,
            signingOk: true,
            acceptedKeys: ["randomx.mode", "randomx.jit"],
            jitActuallyUsed: nil,
            binaryVersion: version
        )
    }

    static func appStoreCompanion() -> EngineCapability {
        resolve(
            channel: .appStoreCompanion,
            binaryPresent: false,
            selftestPassed: false,
            signingOk: true,
            acceptedKeys: [],
            jitActuallyUsed: nil,
            binaryVersion: nil
        )
    }

    static func resolve(
        channel: Channel,
        binaryPresent: Bool,
        selftestPassed: Bool,
        signingOk: Bool,
        acceptedKeys: [String],
        jitActuallyUsed: Bool?,
        binaryVersion: String?
    ) -> EngineCapability {
        if channel == .appStoreCompanion {
            return EngineCapability(
                channel: channel,
                canMineOnDevice: false,
                miningBlockedReason: "App Store companion must not claim on-device mining",
                randomxMode: "unavailable",
                jitEnabled: false,
                jitStatus: .unavailable,
                backgroundReliable: false,
                backgroundReason: "companion has no local miner",
                binaryPresent: false,
                binaryVerified: false,
                warnings: ["Do not reuse sideload copy for App Store listing"]
            )
        }

        var reasons: [String] = []
        if !binaryPresent { reasons.append("bundled miner binary missing") }
        if !selftestPassed { reasons.append("engine selftest not passed") }
        if !signingOk { reasons.append("signing not OK") }
        if channel == .unverified { reasons.append("distribution channel unverified") }

        let canMine = binaryPresent && selftestPassed && signingOk && channel != .unverified
        var warnings: [String] = []
        var jit = false
        var jitStatus: JitStatus = .unavailable

        if !canMine {
            jitStatus = .unavailable
        } else if jitActuallyUsed == true && acceptedKeys.contains("randomx.jit") {
            jit = true
            jitStatus = .verifiedOn
        } else if jitActuallyUsed == false {
            jit = false
            jitStatus = .verifiedOff
            warnings.append("JIT not active — interpreter/light path")
        } else if acceptedKeys.contains("randomx.jit") {
            jit = false
            jitStatus = .keyAcceptedUnverified
            warnings.append("jit config key accepted but runtime unverified — fail closed")
        } else {
            jit = false
            jitStatus = .unsupported
        }

        return EngineCapability(
            channel: channel,
            canMineOnDevice: canMine,
            miningBlockedReason: canMine ? nil : reasons.joined(separator: "; "),
            randomxMode: canMine ? "light" : "unavailable",
            jitEnabled: jit,
            jitStatus: jitStatus,
            backgroundReliable: false,
            backgroundReason: "No reliable permanent background mining on iOS",
            binaryPresent: binaryPresent,
            binaryVerified: binaryPresent && selftestPassed,
            warnings: warnings
        )
    }

    func randomxJSON() -> [String: Any]? {
        guard canMineOnDevice else { return nil }
        return [
            "mode": "light",
            "1gb-pages": false,
            "rdmsr": false,
            "wrmsr": false,
            "cache_qos": false,
            "numa": false,
            "jit": jitEnabled,
            "scratchpad_prefetch_mode": 1
        ]
    }
}
