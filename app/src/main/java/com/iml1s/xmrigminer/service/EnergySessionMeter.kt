package com.iml1s.xmrigminer.service

import com.iml1s.xmrigminer.data.energy.BudgetPeriodState
import com.iml1s.xmrigminer.data.energy.CostEntry
import com.iml1s.xmrigminer.data.energy.ElectricityTariffCalculator
import com.iml1s.xmrigminer.data.energy.EnergyLedgerStore
import com.iml1s.xmrigminer.data.energy.EnergyQuality
import com.iml1s.xmrigminer.data.energy.EnergyRepository
import com.iml1s.xmrigminer.data.energy.EnergySample
import com.iml1s.xmrigminer.data.energy.EnergyScope
import com.iml1s.xmrigminer.data.energy.EnergyUnits
import com.iml1s.xmrigminer.data.energy.StoreCommitResult
import com.iml1s.xmrigminer.data.model.MiningConfig
import java.math.BigDecimal
import java.math.RoundingMode
import java.util.Calendar
import java.util.TimeZone
import java.util.concurrent.atomic.AtomicLong
import javax.inject.Inject
import javax.inject.Singleton

data class EnergyCostSummary(
    val kwh: Double?,
    val fiat: Double?,
    val currency: String,
    val quality: String,
    val sourceLabel: String,
    val unknownReason: String? = null
)

data class EnergyTickResult(
    val committed: Boolean,
    val reason: String? = null,
    val sample: EnergySample? = null,
    val duplicateNoOp: Boolean = false,
    val cost: CostEntry? = null,
    val summary: EnergyCostSummary? = null,
    val budgetVerdict: AutomationPolicy.Verdict? = null
)

/**
 * Session-owned energy meter + budget evaluator (#130).
 * Single recorder; ViewModel rebuilds must not open a second collector.
 */
@Singleton
class EnergySessionMeter @Inject constructor(
    private val store: EnergyLedgerStore
) {
    private val repository = EnergyRepository()
    private val budgetRevision = AtomicLong(0L)
    private var lastTickMs: Long? = null
    private var activeSessionId: String? = null
    private var clockMs: () -> Long = { System.currentTimeMillis() }

    init {
        restoreFromStore()
    }

    /** Test / fake-clock hook. */
    fun setClock(clock: () -> Long) {
        clockMs = clock
    }

    fun repository(): EnergyRepository = repository

    fun restoreFromStore() {
        val state = store.load()
        val cursors = state.cursors.associate { c ->
            c.sourceId to Triple(c.counterWh, c.epoch, c.lastTimestampMs)
        }
        repository.replaceFromEntries(state.entries, cursors)
        state.budget?.let { budgetRevision.set(it.revision) }
    }

    fun applyConfig(config: MiningConfig) {
        repository.setManualWatts(config.manualWatts)
    }

    fun onSessionStart(sessionId: String, nowMs: Long = clockMs()) {
        activeSessionId = sessionId
        lastTickMs = nowMs
    }

    fun onSessionStop(config: MiningConfig, nowMs: Long = clockMs()): EnergyTickResult {
        val result = tick(config, nowMs = nowMs, flush = true)
        activeSessionId = null
        lastTickMs = null
        return result
    }

    /**
     * Record [lastTickMs, nowMs) at configured manual watts, persist atomically, evaluate budget.
     */
    fun tick(
        config: MiningConfig,
        nowMs: Long = clockMs(),
        sampleIntervalMs: Long = DEFAULT_SAMPLE_MS,
        flush: Boolean = false
    ): EnergyTickResult {
        applyConfig(config)
        val start = lastTickMs
        if (start == null) {
            lastTickMs = nowMs
            return EnergyTickResult(
                committed = false,
                reason = "session-not-started",
                summary = costSummary(config, nowMs),
                budgetVerdict = evaluateBudget(config, sessionElapsedMs = null, nowMs = nowMs)
            )
        }
        if (!flush && nowMs - start < sampleIntervalMs) {
            return EnergyTickResult(
                committed = false,
                reason = "interval-pending",
                summary = costSummary(config, nowMs),
                budgetVerdict = evaluateBudget(config, sessionElapsedMs = nowMs - start, nowMs = nowMs)
            )
        }
        if (nowMs <= start) {
            return EnergyTickResult(false, "non-positive-interval")
        }

        val watts = config.manualWatts
        if (watts == null) {
            lastTickMs = nowMs
            val summary = costSummary(config, nowMs)
            return EnergyTickResult(
                committed = false,
                reason = "manual-watts-unset",
                summary = summary.copy(
                    unknownReason = summary.unknownReason ?: "manual-watts-unset"
                ),
                budgetVerdict = evaluateBudget(config, sessionElapsedMs = nowMs - start, nowMs = nowMs)
            )
        }

        val sampleId = "manual:${activeSessionId ?: "none"}:$start:$nowMs"
        val wh = EnergyUnits.integrateWatts(watts, nowMs - start)
            ?: return EnergyTickResult(false, "integrate-failed")
        val sample = EnergySample(
            sampleId = sampleId,
            source = "user-manual",
            scope = EnergyScope.MANUAL,
            quality = EnergyQuality.MANUAL,
            unit = "W",
            value = watts,
            wattHours = wh,
            startMs = start,
            endMs = nowMs,
            monotonicMs = nowMs,
            utcMs = nowMs,
            sessionId = activeSessionId
        )

        val tariffVersion = fixedTariffVersion(config)
        val cost = if (config.electricityRatePerKwh != null && wh.isFinite()) {
            val amount = BigDecimal.valueOf(wh)
                .divide(BigDecimal.valueOf(1000.0), 12, RoundingMode.HALF_UP)
                .multiply(BigDecimal.valueOf(config.electricityRatePerKwh))
            CostEntry(
                intervalSampleId = sampleId,
                tariffVersion = tariffVersion,
                amountExact = amount.toPlainString(),
                currency = config.electricityCurrency,
                quality = "manual"
            )
        } else {
            null
        }

        val dayStart = dayStartMs(nowMs)
        val usedBefore = spentFiatToday(config, nowMs) ?: BigDecimal.ZERO
        val reserve = projectedNextSampleFiat(config, sampleIntervalMs)
        val revision = budgetRevision.incrementAndGet()
        val budget = BudgetPeriodState(
            id = "daily:$dayStart",
            zoneId = TimeZone.getDefault().id,
            periodStartMs = dayStart,
            usedExact = usedBefore.toPlainString(),
            reservedExact = (reserve?.let { BigDecimal.valueOf(it) } ?: BigDecimal.ZERO).toPlainString(),
            revision = revision
        )

        val storeResult = store.commitInterval(sample, cost, budget)
        lastTickMs = nowMs

        return when (storeResult) {
            is StoreCommitResult.Accepted -> {
                repository.commitSample(sample)
                EnergyTickResult(
                    committed = true,
                    sample = sample,
                    cost = cost,
                    summary = costSummary(config, nowMs),
                    budgetVerdict = evaluateBudget(
                        config,
                        sessionElapsedMs = activeSessionId?.let { nowMs - (start) },
                        nowMs = nowMs,
                        projectedNext = reserve
                    )
                )
            }
            is StoreCommitResult.DuplicateNoOp -> {
                EnergyTickResult(
                    committed = false,
                    duplicateNoOp = true,
                    sample = storeResult.entry,
                    reason = "duplicate-noop",
                    summary = costSummary(config, nowMs),
                    budgetVerdict = evaluateBudget(config, null, nowMs, reserve)
                )
            }
            is StoreCommitResult.Rejected -> {
                EnergyTickResult(
                    committed = false,
                    reason = storeResult.reason,
                    summary = costSummary(config, nowMs),
                    budgetVerdict = evaluateBudget(config, null, nowMs, reserve)
                )
            }
        }
    }

    fun evaluateBudget(
        config: MiningConfig,
        sessionElapsedMs: Long?,
        nowMs: Long = clockMs(),
        projectedNext: Double? = projectedNextSampleFiat(config, DEFAULT_SAMPLE_MS)
    ): AutomationPolicy.Verdict {
        val defaults = AutomationPolicy.Defaults(
            economicGoal = AutomationPolicy.EconomicGoal.HOBBY,
            dailySpendCapFiat = config.dailySpendCapFiat,
            monthlySpendCapFiat = config.monthlySpendCapFiat,
            dailyKwhCap = config.dailyKwhCap,
            sessionMaxMs = null,
            minReserveSocPercent = null
        )
        val kwh = kwhInRange(dayStartMs(nowMs), nowMs)
        val spent = spentFiatToday(config, nowMs)?.toDouble()
        val budget = AutomationPolicy.Budget(
            spentFiatToday = if (config.dailySpendCapFiat != null) spent else spent,
            spentFiatMonth = if (config.monthlySpendCapFiat != null) {
                spentFiatInRange(config, monthStartMs(nowMs), nowMs)?.toDouble()
            } else {
                null
            },
            kwhToday = kwh,
            sessionElapsedMs = sessionElapsedMs,
            projectedNextSampleFiat = projectedNext
        )
        // Manual Start path: treat as armed so budget (not arming) is the gate.
        return AutomationPolicy.evaluate(
            intent = AutomationPolicy.armAutomation(AutomationPolicy.Intent()),
            config = defaults,
            budget = budget,
            manualStart = true
        )
    }

    fun costSummary(config: MiningConfig, nowMs: Long = clockMs()): EnergyCostSummary {
        val from = dayStartMs(nowMs)
        val kwh = kwhInRange(from, nowMs)
        val rate = config.electricityRatePerKwh
        val bill = if (kwh != null && rate != null) {
            ElectricityTariffCalculator.billFixed(kwh, rate)
        } else {
            null
        }
        val snap = repository.snapshot()
        val quality = when {
            kwh == null -> "unknown"
            snap.deviceQuality == EnergyQuality.MANUAL -> "manual"
            else -> snap.deviceQuality.name.lowercase()
        }
        return EnergyCostSummary(
            kwh = kwh,
            fiat = bill?.takeIf { it.ok }?.amount,
            currency = config.electricityCurrency,
            quality = quality,
            sourceLabel = if (config.manualWatts != null) "manual ${config.manualWatts}W" else "unset",
            unknownReason = when {
                config.manualWatts == null && (config.dailySpendCapFiat != null || config.dailyKwhCap != null) ->
                    "manual-watts-unset"
                rate == null && kwh != null -> "rate-unset"
                else -> null
            }
        )
    }

    fun kwhInRange(fromMs: Long, toMs: Long): Double? {
        val samples = repository.exportRange(fromMs, toMs)
        if (samples.isEmpty()) return 0.0
        var sum = 0.0
        var anyKnown = false
        var anyUnknown = false
        for (s in samples) {
            if (s.quality == EnergyQuality.UNKNOWN || s.wattHours == null) {
                anyUnknown = true
                continue
            }
            if (!s.wattHours.isFinite()) continue
            sum += s.wattHours
            anyKnown = true
        }
        if (!anyKnown && anyUnknown) return null
        return sum / 1000.0
    }

    fun spentFiatToday(config: MiningConfig, nowMs: Long = clockMs()): BigDecimal? {
        return spentFiatInRange(config, dayStartMs(nowMs), nowMs)
    }

    fun spentFiatInRange(config: MiningConfig, fromMs: Long, toMs: Long): BigDecimal? {
        val rate = config.electricityRatePerKwh ?: return null
        val kwh = kwhInRange(fromMs, toMs) ?: return null
        return BigDecimal.valueOf(kwh)
            .multiply(BigDecimal.valueOf(rate))
    }

    fun projectedNextSampleFiat(config: MiningConfig, sampleIntervalMs: Long): Double? {
        val watts = config.manualWatts ?: return null
        val rate = config.electricityRatePerKwh ?: return null
        val kwh = (watts * sampleIntervalMs) / 3_600_000.0 / 1000.0
        // Include stop-delay reserve (one extra sample window).
        val reservedKwh = kwh * 2.0
        return reservedKwh * rate
    }

    fun replaySample(sample: EnergySample, cost: CostEntry? = null): StoreCommitResult {
        val result = store.commitInterval(sample, cost)
        if (result is StoreCommitResult.Accepted) {
            repository.commitSample(sample)
        }
        return result
    }

    companion object {
        const val DEFAULT_SAMPLE_MS = 5_000L

        fun dayStartMs(nowMs: Long, timeZone: TimeZone = TimeZone.getDefault()): Long {
            val c = Calendar.getInstance(timeZone)
            c.timeInMillis = nowMs
            c.set(Calendar.HOUR_OF_DAY, 0)
            c.set(Calendar.MINUTE, 0)
            c.set(Calendar.SECOND, 0)
            c.set(Calendar.MILLISECOND, 0)
            return c.timeInMillis
        }

        fun monthStartMs(nowMs: Long, timeZone: TimeZone = TimeZone.getDefault()): Long {
            val c = Calendar.getInstance(timeZone)
            c.timeInMillis = nowMs
            c.set(Calendar.DAY_OF_MONTH, 1)
            c.set(Calendar.HOUR_OF_DAY, 0)
            c.set(Calendar.MINUTE, 0)
            c.set(Calendar.SECOND, 0)
            c.set(Calendar.MILLISECOND, 0)
            return c.timeInMillis
        }

        fun fixedTariffVersion(config: MiningConfig): String {
            return "fixed:${config.electricityRatePerKwh}:${config.electricityCurrency}"
        }

        /** Acceptance helper: 50W × 2h @ 5/kWh → 0.1 kWh / 0.5 fiat. */
        fun manualCostExample(
            watts: Double = 50.0,
            durationMs: Long = 2L * 3_600_000L,
            ratePerKwh: Double = 5.0
        ): Pair<Double, Double> {
            val kwh = EnergyUnits.integrateWatts(watts, durationMs)!! / 1000.0
            return kwh to (kwh * ratePerKwh)
        }
    }
}
