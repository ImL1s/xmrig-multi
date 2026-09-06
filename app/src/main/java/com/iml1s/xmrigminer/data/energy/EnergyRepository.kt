package com.iml1s.xmrigminer.data.energy

/**
 * Manual wattage provider + ledger façade (#70).
 * Does not invent TDP / charger-rated Watts as measured.
 */
class EnergyRepository {
    private var ledger = EnergyLedger()
    private var manualWatts: Double? = null
    private var manualScope: EnergyScope = EnergyScope.MANUAL

    fun setManualWatts(watts: Double?) {
        manualWatts = watts?.takeIf { it.isFinite() && it >= 0.0 }
    }

    fun manualWatts(): Double? = manualWatts

    /**
     * Record a manual energy interval using configured watts (quality=manual).
     */
    fun commitManualInterval(startMs: Long, endMs: Long, sampleId: String? = null): CommitResult {
        val w = manualWatts ?: return CommitResult(false, "manual-watts-unset")
        return ledger.commitRaw(
            source = "user-manual",
            scopeWire = manualScope.wire(),
            quality = EnergyQuality.MANUAL,
            unit = "W",
            value = w,
            startMs = startMs,
            endMs = endMs,
            sampleId = sampleId
        )
    }

    fun commitSample(sample: EnergySample): CommitResult = ledger.commit(sample)

    fun commitCumulative(
        source: String,
        valueWh: Double,
        endMs: Long,
        meterEpoch: String = "default"
    ): CommitResult = ledger.commitCumulative(
        source = source,
        value = valueWh,
        endMs = endMs,
        meterEpoch = meterEpoch
    )

    fun snapshot(): EnergySnapshot = ledger.snapshot()

    fun calibrate(
        baselineMode: BaselineMode,
        baselineWh: Double?,
        baselineTrusted: Boolean = true
    ): IncrementalCalibration {
        val device = ledger.deviceWattHours()
        return calibrateIncremental(device.first, baselineWh, baselineMode, baselineTrusted)
    }

    fun exportRange(fromMs: Long, toMs: Long): List<EnergySample> = ledger.exportRange(fromMs, toMs)

    /** Restore from persisted entries (dedupe-safe rebuild). */
    fun replaceFromEntries(entries: List<EnergySample>) {
        ledger = EnergyLedger.fromEntries(entries)
    }

    fun underlyingLedger(): EnergyLedger = ledger
}
