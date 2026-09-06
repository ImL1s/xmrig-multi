package com.iml1s.xmrigminer.data.energy

/**
 * Android port of shared/electricity-tariff (#71).
 * Unknown rates stay null — never invent 0.
 */
sealed class ElectricityTariff {
    abstract val id: String
    abstract val currency: String
    abstract val label: String
    abstract val rateUnknown: Boolean

    data class Fixed(
        override val id: String = "manual-fixed",
        override val currency: String = "TWD",
        override val label: String = "Manual fixed",
        val ratePerKwh: Double?,
        val verification: String = "user-manual"
    ) : ElectricityTariff() {
        override val rateUnknown: Boolean get() = ratePerKwh == null || !ratePerKwh.isFinite()
    }

    data class Tier(val upToKwh: Double, val ratePerKwh: Double)

    data class Progressive(
        override val id: String = "manual-progressive",
        override val currency: String = "TWD",
        override val label: String = "Manual progressive",
        val tiers: List<Tier>,
        val verification: String = "user-manual",
        val effectiveFrom: String? = null
    ) : ElectricityTariff() {
        override val rateUnknown: Boolean get() = tiers.any { !it.ratePerKwh.isFinite() }
    }

    data class TouPeriod(
        val id: String,
        val ratePerKwh: Double,
        val startMinute: Int,
        val endMinute: Int,
        val daysOfWeek: List<Int>? = null
    )

    data class Tou(
        override val id: String = "manual-tou",
        override val currency: String = "TWD",
        override val label: String = "Manual TOU",
        val periods: List<TouPeriod>,
        val timeZone: String = "Asia/Taipei",
        val verification: String = "user-manual",
        val effectiveFrom: String? = null
    ) : ElectricityTariff() {
        override val rateUnknown: Boolean get() = periods.any { !it.ratePerKwh.isFinite() }
    }
}

data class TariffBillResult(
    val ok: Boolean,
    val amount: Double? = null,
    val reason: String? = null,
    val method: String? = null,
    val estimated: Boolean = false
)

object ElectricityTariffCalculator {

    fun billFixed(kwh: Double, ratePerKwh: Double?): TariffBillResult {
        if (!kwh.isFinite() || kwh < 0) return TariffBillResult(false, reason = "invalid-kwh")
        if (ratePerKwh == null || !ratePerKwh.isFinite()) {
            return TariffBillResult(false, reason = "unknown-rate")
        }
        return TariffBillResult(true, amount = kwh * ratePerKwh, method = "fixed")
    }

    fun billProgressive(kwh: Double, tiers: List<ElectricityTariff.Tier>): TariffBillResult {
        if (!kwh.isFinite() || kwh < 0) return TariffBillResult(false, reason = "invalid-kwh")
        if (tiers.isEmpty()) return TariffBillResult(false, reason = "no-tiers")
        var remaining = kwh
        var prevCap = 0.0
        var amount = 0.0
        for (tier in tiers) {
            if (!tier.ratePerKwh.isFinite()) return TariffBillResult(false, reason = "unknown-rate")
            val width = if (tier.upToKwh.isFinite()) {
                (tier.upToKwh - prevCap).coerceAtLeast(0.0)
            } else {
                remaining
            }
            val take = minOf(remaining, width)
            if (take > 0) {
                amount += take * tier.ratePerKwh
                remaining -= take
            }
            prevCap = if (tier.upToKwh.isFinite()) tier.upToKwh else prevCap + take
            if (remaining <= 0.0) break
        }
        if (remaining > 1e-12) return TariffBillResult(false, reason = "tiers-exhausted")
        return TariffBillResult(true, amount = amount, method = "progressive")
    }

    fun marginalProgressive(
        baseKwh: Double,
        miningKwh: Double,
        tiers: List<ElectricityTariff.Tier>
    ): TariffBillResult {
        if (!miningKwh.isFinite() || miningKwh < 0) {
            return TariffBillResult(false, reason = "invalid-mining-kwh")
        }
        if (!baseKwh.isFinite() || baseKwh < 0) {
            return TariffBillResult(false, reason = "invalid-base-kwh")
        }
        val withMine = billProgressive(baseKwh + miningKwh, tiers)
        val base = billProgressive(baseKwh, tiers)
        if (!withMine.ok || !base.ok) {
            return TariffBillResult(false, reason = withMine.reason ?: base.reason)
        }
        return TariffBillResult(
            true,
            amount = withMine.amount!! - base.amount!!,
            method = "counterfactual-progressive"
        )
    }

    fun inMinuteWindow(minute: Int, start: Int, end: Int): Boolean {
        if (start == end) return true
        return if (start < end) minute in start until end else minute >= start || minute < end
    }

    fun marginalCost(tariff: ElectricityTariff, baseKwh: Double, miningKwh: Double): TariffBillResult {
        if (tariff.rateUnknown) return TariffBillResult(false, reason = "unknown-rate")
        return when (tariff) {
            is ElectricityTariff.Fixed -> billFixed(miningKwh, tariff.ratePerKwh)
                .let {
                    if (it.ok) it.copy(method = "fixed-marginal") else it
                }
            is ElectricityTariff.Progressive -> marginalProgressive(baseKwh, miningKwh, tariff.tiers)
            is ElectricityTariff.Tou -> TariffBillResult(false, reason = "marginal-not-defined-for-kind")
        }
    }

    fun roundMoney(amount: Double, decimals: Int = 2): Double? {
        if (!amount.isFinite()) return null
        var f = 1.0
        repeat(decimals) { f *= 10.0 }
        return kotlin.math.round(amount * f) / f
    }
}
