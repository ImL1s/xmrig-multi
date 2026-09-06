package com.iml1s.xmrigminer.native

import com.iml1s.xmrigminer.data.model.CoinType

/**
 * Compile-time / product capabilities of packaged engines.
 * Keep TLS flags in sync with `scripts/build_xmrig.sh`.
 * Coin gates: #26–#28 — do not claim supported without verified PoW/protocol.
 */
object XmrigNativeCapabilities {
    const val TLS_ENABLED = false
    const val TLS_UNSUPPORTED_MESSAGE =
        "此 Android 礦機未編譯 TLS，請關閉 Use TLS/SSL 並使用非 SSL 礦池埠"

    enum class CoinStatus {
        SUPPORTED,
        UNAVAILABLE
    }

    data class CoinCapability(
        val status: CoinStatus,
        val reason: String
    )

    private val coinCapabilities = mapOf(
        CoinType.MONERO to CoinCapability(
            CoinStatus.SUPPORTED,
            "Packaged XMRig RandomX (rx/0) Stratum path"
        ),
        CoinType.WOWNERO to CoinCapability(
            CoinStatus.UNAVAILABLE,
            "Wownero presets unverified; need trusted signer/daemon flow before start (#28)"
        ),
        CoinType.DERO to CoinCapability(
            CoinStatus.UNAVAILABLE,
            "DERO requires a dedicated daemon miner adapter, not XMRig astrobwt/v3 Stratum (#27)"
        )
    )

    fun capabilityFor(coin: CoinType): CoinCapability =
        coinCapabilities[coin] ?: CoinCapability(
            CoinStatus.UNAVAILABLE,
            "Unknown coin"
        )

    fun assertStartAllowed(coin: CoinType): String? {
        val cap = capabilityFor(coin)
        return if (cap.status == CoinStatus.SUPPORTED) null else cap.reason
    }

    /** MoneroOcean pays XMR; reject non-Monero coin pairing (#29). */
    fun assertMoneroOceanPayout(poolNameOrUrl: String, coin: CoinType, wallet: String): String? {
        val key = poolNameOrUrl.lowercase()
        if (!key.contains("moneroocean")) return null
        if (coin != CoinType.MONERO) {
            return "MoneroOcean 以 XMR 收款，不可使用 ${coin.displayName} 地址當付款帳號 (#29)"
        }
        val ok = (wallet.startsWith("4") || wallet.startsWith("8")) && wallet.length >= 95
        return if (ok) null else "MoneroOcean 需要有效的 Monero 收款地址（4… / 8…）"
    }
}
