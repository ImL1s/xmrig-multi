package com.iml1s.xmrigminer.data.economy

/**
 * Android port of shared/economy-snapshot (#72).
 */
data class EconomySnapshot(
    val schemaVersion: Int = SCHEMA_VERSION,
    val expectedGross: Double?,
    val credited: Double?,
    val paid: Double?,
    val unpaid: Double?,
    val valueLayer: String?,
    val netNative: Double?,
    val feeNative: Double,
    val poolFeeAlreadyDeducted: Boolean,
    val marketRate: Double?,
    val marketRateSource: String?,
    val marketRateAtMs: Long?,
    val marketRateExpired: Boolean,
    val fiatGross: Double?,
    val energyCostFiat: Double?,
    val netFiat: Double?,
    val netQuality: String,
    val profitable: Boolean?
) {
    companion object {
        const val SCHEMA_VERSION = 1
    }
}

object EconomySnapshotBuilder {
    fun build(
        expectedGross: Double? = null,
        credited: Double? = null,
        paid: Double? = null,
        poolFeeAlreadyDeducted: Boolean = false,
        developerFeeNative: Double? = null,
        energyCostFiat: Double? = null,
        marketRate: Double? = null,
        marketRateSource: String? = null,
        marketRateAtMs: Long? = null,
        marketRateExpired: Boolean = false
    ): EconomySnapshot {
        val eg = finiteOrNull(expectedGross)
        val cr = finiteOrNull(credited)
        val pd = finiteOrNull(paid)
        val unpaid = if (cr != null && pd != null) maxOf(0.0, cr - pd) else null

        var nativeForValue: Double? = null
        var valueLayer: String? = null
        when {
            cr != null -> {
                nativeForValue = cr
                valueLayer = "credited"
            }
            eg != null -> {
                nativeForValue = eg
                valueLayer = "expected_gross"
            }
        }

        val feeNative = when {
            poolFeeAlreadyDeducted -> 0.0
            finiteOrNull(developerFeeNative) != null -> developerFeeNative!!
            else -> 0.0
        }
        val netNative = nativeForValue?.let { maxOf(0.0, it - feeNative) }
        val rate = finiteOrNull(marketRate)
        val rateOk = rate != null && !marketRateExpired
        val fiatGross = if (netNative != null && rateOk) netNative * rate!! else null
        val energy = finiteOrNull(energyCostFiat)

        val (netFiat, netQuality) = when {
            fiatGross != null && energy != null -> (fiatGross - energy) to "estimated"
            else -> null to "unknown"
        }

        return EconomySnapshot(
            expectedGross = eg,
            credited = cr,
            paid = pd,
            unpaid = unpaid,
            valueLayer = valueLayer,
            netNative = netNative,
            feeNative = feeNative,
            poolFeeAlreadyDeducted = poolFeeAlreadyDeducted,
            marketRate = rate,
            marketRateSource = marketRateSource,
            marketRateAtMs = marketRateAtMs,
            marketRateExpired = marketRateExpired,
            fiatGross = fiatGross,
            energyCostFiat = energy,
            netFiat = netFiat,
            netQuality = netQuality,
            profitable = if (netFiat == null || netQuality == "unknown") null else netFiat > 0
        )
    }

    fun dedupeWalletBalances(balances: List<Pair<String, Double>>): Pair<Double, Int> {
        val byWallet = linkedMapOf<String, Double>()
        for ((wallet, bal) in balances) {
            val v = finiteOrNull(bal) ?: continue
            byWallet[wallet] = maxOf(byWallet[wallet] ?: v, v)
        }
        return byWallet.values.sum() to byWallet.size
    }

    fun csvSafe(value: String?): String {
        if (value == null) return ""
        var s = value
        if (s.matches(Regex("^[=+\\-@].*"))) s = "'$s"
        if (s.contains(',') || s.contains('"') || s.contains('\n')) {
            s = "\"" + s.replace("\"", "\"\"") + "\""
        }
        return s
    }

    private fun finiteOrNull(v: Double?): Double? =
        if (v != null && v.isFinite()) v else null
}
