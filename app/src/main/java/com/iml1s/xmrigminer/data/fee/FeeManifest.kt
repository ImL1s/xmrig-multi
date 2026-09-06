package com.iml1s.xmrigminer.data.fee

import com.iml1s.xmrigminer.service.DevFeePolicy

/**
 * Android fee transparency surface (#63).
 * Numbers must stay aligned with shared/fee-manifest and DevFeePolicy.
 */
object FeeManifest {

    const val BASIS = "mining-time-window"
    const val BASIS_NOTE =
        "Time share of hashing (not a wallet balance deduction; not a pool fee)"

    data class Layer(
        val id: String,
        val kind: String,
        val rateLabel: String,
        val adjustable: Boolean,
        val note: String? = null
    )

    data class Summary(
        val platform: String,
        val mismatch: Boolean,
        val lines: List<String>,
        val layers: List<Layer>,
        val developerWallet: String
    )

    fun androidSummary(poolFeePercent: Double? = null): Summary {
        val poolLabel = if (poolFeePercent != null) {
            "${poolFeePercent}%"
        } else {
            "unknown (not 0%)"
        }
        val layers = listOf(
            Layer(
                id = "developer",
                kind = "developer",
                rateLabel = "${DevFeePolicy.PERCENT}% ($BASIS)",
                adjustable = false,
                note = "XMRig donate-level; mandatory minimum ${DevFeePolicy.PERCENT}%"
            ),
            Layer(
                id = "pool",
                kind = "pool",
                rateLabel = poolLabel,
                adjustable = false,
                note = "Pool operator fee — never invent 0% when unknown"
            )
        )
        val lines = buildList {
            add("Basis: $BASIS_NOTE")
            layers.forEach { add("${it.kind}: ${it.rateLabel} — mandatory/read-only") }
        }
        return Summary(
            platform = "android",
            mismatch = false,
            lines = lines,
            layers = layers,
            developerWallet = DevFeePolicy.WALLET
        )
    }

    fun iosTrackedBinaryMismatch(): Boolean = true

    fun iosSummary(): Summary {
        val layers = listOf(
            Layer(
                id = "upstream-or-developer",
                kind = "developer",
                rateLabel = "1% ($BASIS)",
                adjustable = false,
                note = "Tracked .a uses upstream donate until rebuild"
            ),
            Layer(
                id = "pool",
                kind = "pool",
                rateLabel = "unknown (not 0%)",
                adjustable = false
            )
        )
        return Summary(
            platform = "ios",
            mismatch = true,
            lines = listOf(
                "⚠ Artifact mismatch: tracked libxmrig-ios-arm64.a is upstream donate until rebuild",
                "Basis: $BASIS_NOTE"
            ) + layers.map { "${it.kind}: ${it.rateLabel}" },
            layers = layers,
            developerWallet = DevFeePolicy.WALLET
        )
    }
}
