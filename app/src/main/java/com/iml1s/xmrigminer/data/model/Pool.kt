package com.iml1s.xmrigminer.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * 支援的加密貨幣類型
 */
enum class CoinType(val displayName: String, val algorithm: String, val xmrigCoin: String?) {
    MONERO("Monero (XMR)", "rx/0", "monero"),
    WOWNERO("Wownero (WOW)", "rx/wow", "wownero"),
    DERO("Dero (DERO)", "astrobwt/v3", "dero");

    companion object {
        fun fromString(value: String): CoinType {
            return entries.find { it.name.equals(value, ignoreCase = true) } ?: MONERO
        }
    }
}

@Serializable
data class Pool(
    val id: String? = null,
    val name: String,
    val url: String,
    @SerialName("ssl_url") val sslUrl: String,
    val description: String,
    val fee: String,
    val coin: String = "MONERO",
    /** supported | unavailable | unverified — see #26–#29 / #41 */
    val status: String = "supported",
    @SerialName("payout_asset") val payoutAsset: String? = null,
    val kind: String? = null,
    @SerialName("registry_status") val registryStatus: String? = null,
    @SerialName("last_reviewed_at") val lastReviewedAt: String? = null,
    @SerialName("novice_default") val noviceDefault: Boolean? = null
) {
    fun getUrl(useTls: Boolean): String = if (useTls) sslUrl else url

    fun getCoinType(): CoinType = CoinType.fromString(coin)

    fun isStartAllowed(): Boolean =
        status.equals("supported", ignoreCase = true) ||
            status.equals("unverified", ignoreCase = true)
}
