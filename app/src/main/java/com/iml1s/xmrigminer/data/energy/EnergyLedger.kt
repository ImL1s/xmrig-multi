package com.iml1s.xmrigminer.data.energy

/**
 * Android port of shared/energy-ledger (#70).
 * Unknown power never becomes 0 W / 0 kWh.
 */
object EnergyUnits {
    fun toWattHours(value: Double, unit: String): Double? = when (unit) {
        "Wh" -> value
        "kWh" -> value * 1000.0
        "mWh" -> value / 1000.0
        "nWh" -> value / 1_000_000.0
        "W" -> null
        else -> null
    }

    /** W × ms → Wh */
    fun integrateWatts(watts: Double, durationMs: Long): Double? {
        if (!watts.isFinite() || durationMs < 0L) return null
        return watts * durationMs / 3_600_000.0
    }
}

enum class EnergyScope {
    WALL, USB, CPU_PACKAGE, GPU, BATTERY_NET, MANUAL;

    fun wire(): String = when (this) {
        WALL -> "wall"
        USB -> "usb"
        CPU_PACKAGE -> "cpu_package"
        GPU -> "gpu"
        BATTERY_NET -> "battery_net"
        MANUAL -> "manual"
    }

    companion object {
        fun fromWire(s: String): EnergyScope? = when (s) {
            "wall" -> WALL
            "usb" -> USB
            "cpu_package" -> CPU_PACKAGE
            "gpu" -> GPU
            "battery_net" -> BATTERY_NET
            "manual" -> MANUAL
            else -> null
        }
    }
}

enum class EnergyQuality { MANUAL, MEASURED, ESTIMATED, UNKNOWN }

enum class BaselineMode { OFF, IDLE, CLOCK }

data class EnergySample(
    val sampleId: String,
    val source: String,
    val scope: EnergyScope,
    val quality: EnergyQuality,
    val unit: String?,
    val value: Double?,
    val wattHours: Double?,
    val startMs: Long,
    val endMs: Long,
    val monotonicMs: Long = endMs,
    val utcMs: Long = endMs,
    val meterEpoch: String = "default",
    val sessionId: String? = null,
    val profileId: String? = null,
    val includesDisplay: Boolean = false,
    val includesChargingLoad: Boolean = false,
    val unknownReason: String? = null
)

data class NormalizeResult(val ok: Boolean, val sample: EnergySample? = null, val reason: String? = null)

object EnergySampleNormalizer {
    fun normalize(
        source: String = "unknown",
        scopeWire: String,
        quality: EnergyQuality,
        unit: String?,
        value: Double?,
        startMs: Long,
        endMs: Long,
        sampleId: String? = null,
        meterEpoch: String = "default",
        sessionId: String? = null,
        profileId: String? = null,
        includesDisplay: Boolean = false,
        includesChargingLoad: Boolean = false,
        unknownReason: String? = null,
        monotonicMs: Long = endMs,
        utcMs: Long = endMs
    ): NormalizeResult {
        val scope = EnergyScope.fromWire(scopeWire)
            ?: return NormalizeResult(false, reason = "invalid-scope")
        if (endMs < startMs) return NormalizeResult(false, reason = "invalid-interval")
        val id = sampleId ?: "$source:${scope.wire()}:$startMs:$endMs:$value:$unit"

        if (quality == EnergyQuality.UNKNOWN) {
            return NormalizeResult(
                true,
                EnergySample(
                    sampleId = id,
                    source = source,
                    scope = scope,
                    quality = EnergyQuality.UNKNOWN,
                    unit = unit,
                    value = null,
                    wattHours = null,
                    startMs = startMs,
                    endMs = endMs,
                    monotonicMs = monotonicMs,
                    utcMs = utcMs,
                    meterEpoch = meterEpoch,
                    sessionId = sessionId,
                    profileId = profileId,
                    includesDisplay = includesDisplay,
                    includesChargingLoad = includesChargingLoad,
                    unknownReason = unknownReason ?: "quality-unknown"
                )
            )
        }

        if (value == null || !value.isFinite()) {
            return NormalizeResult(false, reason = "invalid-value")
        }

        val wh = when (unit) {
            "W" -> EnergyUnits.integrateWatts(value, endMs - startMs)
            else -> unit?.let { EnergyUnits.toWattHours(value, it) }
        } ?: return NormalizeResult(false, reason = "unsupported-unit")

        return NormalizeResult(
            true,
            EnergySample(
                sampleId = id,
                source = source,
                scope = scope,
                quality = quality,
                unit = unit,
                value = value,
                wattHours = wh,
                startMs = startMs,
                endMs = endMs,
                monotonicMs = monotonicMs,
                utcMs = utcMs,
                meterEpoch = meterEpoch,
                sessionId = sessionId,
                profileId = profileId,
                includesDisplay = includesDisplay,
                includesChargingLoad = includesChargingLoad,
                unknownReason = null
            )
        )
    }
}

data class CumulativeDelta(
    val deltaWh: Double?,
    val event: String,
    val unknown: Boolean
)

fun cumulativeDelta(
    prevWh: Double?,
    nextWh: Double,
    prevEpoch: String,
    nextEpoch: String
): CumulativeDelta {
    if (prevEpoch != nextEpoch) {
        return CumulativeDelta(null, "new-meter-epoch", true)
    }
    if (prevWh == null || !prevWh.isFinite()) {
        return CumulativeDelta(null, "no-baseline", true)
    }
    if (!nextWh.isFinite()) {
        return CumulativeDelta(null, "invalid-reading", true)
    }
    if (nextWh < prevWh) {
        return CumulativeDelta(null, "counter-reset", true)
    }
    return CumulativeDelta(nextWh - prevWh, "ok", false)
}

data class IncrementalCalibration(
    val deviceWh: Double?,
    val baselineWh: Double?,
    val incrementalWh: Double?,
    val baselineMode: BaselineMode,
    val quality: EnergyQuality,
    val note: String?
)

fun calibrateIncremental(
    deviceWh: Double?,
    baselineWh: Double?,
    baselineMode: BaselineMode,
    baselineTrusted: Boolean = true
): IncrementalCalibration {
    if (deviceWh == null || !deviceWh.isFinite()) {
        return IncrementalCalibration(
            null, null, null, baselineMode, EnergyQuality.UNKNOWN, "device-energy-unknown"
        )
    }
    if (baselineMode == BaselineMode.OFF) {
        return IncrementalCalibration(
            deviceWh, 0.0, deviceWh, baselineMode, EnergyQuality.ESTIMATED,
            "baseline-off-no-standby-deduction"
        )
    }
    if (!baselineTrusted || baselineWh == null || !baselineWh.isFinite()) {
        return IncrementalCalibration(
            deviceWh, null, null, baselineMode, EnergyQuality.UNKNOWN,
            "baseline-untrusted-or-missing"
        )
    }
    val inc = deviceWh - baselineWh
    if (inc < 0) {
        return IncrementalCalibration(
            deviceWh, baselineWh, null, baselineMode, EnergyQuality.UNKNOWN,
            "negative-incremental-treated-as-noise"
        )
    }
    return IncrementalCalibration(
        deviceWh, baselineWh, inc, baselineMode, EnergyQuality.ESTIMATED, null
    )
}

data class SharedMeterAttribution(
    val mode: String,
    val totalWh: Double?,
    val perMiner: Map<String, Double>,
    val note: String
)

fun attributeSharedMeter(
    wallWh: Double?,
    minerIds: List<String>,
    mode: String = "shared_total"
): SharedMeterAttribution {
    if (wallWh == null || !wallWh.isFinite()) {
        return SharedMeterAttribution(mode, null, emptyMap(), "unknown-meter")
    }
    if (mode == "equal_split" && minerIds.isNotEmpty()) {
        val each = wallWh / minerIds.size
        return SharedMeterAttribution(
            mode,
            wallWh,
            minerIds.associateWith { each },
            "equal-split-estimate-not-precision"
        )
    }
    return SharedMeterAttribution(
        "shared_total",
        wallWh,
        emptyMap(),
        "shared-socket-counted-once"
    )
}

data class CommitResult(
    val accepted: Boolean,
    val reason: String? = null,
    val entry: EnergySample? = null
)

data class EnergySnapshot(
    val schemaVersion: Int,
    val byScopeWh: Map<String, Double>,
    val deviceWh: Double?,
    val deviceScope: String?,
    val deviceQuality: EnergyQuality,
    val knownCoverageMs: Long,
    val unknownCoverageMs: Long,
    val coverageRatio: Double?,
    val entryCount: Int
)

/**
 * In-memory ledger with dedupe; callers persist snapshots via repository.
 */
class EnergyLedger(private val maxGapMs: Long = 15 * 60 * 1000L) {
    companion object {
        const val SCHEMA_VERSION = 1

        fun fromEntries(entries: List<EnergySample>, maxGapMs: Long = 15 * 60 * 1000L): EnergyLedger {
            val ledger = EnergyLedger(maxGapMs)
            entries.forEach { ledger.commit(it) }
            return ledger
        }
    }

    private val entries = LinkedHashMap<String, EnergySample>()
    private val lastCumulative = HashMap<String, Triple<Double, String, Long>>() // wh, epoch, endMs
    private val committedWhByScope = HashMap<String, Double>()
    var unknownCoverageMs: Long = 0L
        private set
    var knownCoverageMs: Long = 0L
        private set

    fun commit(sample: EnergySample): CommitResult {
        if (entries.containsKey(sample.sampleId)) {
            return CommitResult(false, "duplicate", entries[sample.sampleId])
        }
        val duration = (sample.endMs - sample.startMs).coerceAtLeast(0L)
        if (sample.quality == EnergyQuality.UNKNOWN || sample.wattHours == null) {
            unknownCoverageMs += duration
            entries[sample.sampleId] = sample
            return CommitResult(true, entry = sample)
        }
        knownCoverageMs += duration
        val key = sample.scope.wire()
        committedWhByScope[key] = (committedWhByScope[key] ?: 0.0) + sample.wattHours
        entries[sample.sampleId] = sample
        return CommitResult(true, entry = sample)
    }

    fun commitRaw(
        source: String,
        scopeWire: String,
        quality: EnergyQuality,
        unit: String,
        value: Double,
        startMs: Long,
        endMs: Long,
        sampleId: String? = null
    ): CommitResult {
        val norm = EnergySampleNormalizer.normalize(
            source = source,
            scopeWire = scopeWire,
            quality = quality,
            unit = unit,
            value = value,
            startMs = startMs,
            endMs = endMs,
            sampleId = sampleId
        )
        if (!norm.ok || norm.sample == null) {
            return CommitResult(false, norm.reason)
        }
        return commit(norm.sample)
    }

    fun commitCumulative(
        source: String = "meter",
        scope: EnergyScope = EnergyScope.WALL,
        unit: String = "Wh",
        value: Double,
        endMs: Long,
        meterEpoch: String = "default",
        quality: EnergyQuality = EnergyQuality.MEASURED,
        sampleId: String? = null,
        utcMs: Long = endMs,
        sessionId: String? = null,
        profileId: String? = null
    ): CommitResult {
        val wh = EnergyUnits.toWattHours(value, unit)
            ?: return CommitResult(false, "invalid-cumulative")
        val meterKey = "$source:${scope.wire()}"
        val prev = lastCumulative[meterKey]
        val delta = cumulativeDelta(prev?.first, wh, prev?.second ?: meterEpoch, meterEpoch)
        lastCumulative[meterKey] = Triple(wh, meterEpoch, endMs)

        if (delta.unknown) {
            val gapStart = prev?.third ?: endMs
            return commit(
                EnergySample(
                    sampleId = sampleId ?: "cum-unknown:$meterKey:$endMs:${delta.event}",
                    source = source,
                    scope = scope,
                    quality = EnergyQuality.UNKNOWN,
                    unit = "Wh",
                    value = null,
                    wattHours = null,
                    startMs = gapStart,
                    endMs = endMs,
                    utcMs = utcMs,
                    meterEpoch = meterEpoch,
                    sessionId = sessionId,
                    profileId = profileId,
                    unknownReason = delta.event
                )
            )
        }
        val startMs = prev!!.third
        val gapMs = endMs - startMs
        if (gapMs > maxGapMs) {
            unknownCoverageMs += gapMs
        }
        return commit(
            EnergySample(
                sampleId = sampleId ?: "cum:$meterKey:$startMs:$endMs",
                source = source,
                scope = scope,
                quality = quality,
                unit = "Wh",
                value = delta.deltaWh,
                wattHours = delta.deltaWh,
                startMs = startMs,
                endMs = endMs,
                utcMs = utcMs,
                meterEpoch = meterEpoch,
                sessionId = sessionId,
                profileId = profileId
            )
        )
    }

    fun deviceWattHours(
        prefer: List<EnergyScope> = listOf(EnergyScope.WALL, EnergyScope.USB, EnergyScope.MANUAL)
    ): Triple<Double?, String?, EnergyQuality> {
        for (scope in prefer) {
            val wh = committedWhByScope[scope.wire()]
            if (wh != null) {
                val q = if (scope == EnergyScope.MANUAL) EnergyQuality.MANUAL else EnergyQuality.MEASURED
                return Triple(wh, scope.wire(), q)
            }
        }
        return Triple(null, null, EnergyQuality.UNKNOWN)
    }

    fun snapshot(): EnergySnapshot {
        val (deviceWh, deviceScope, deviceQuality) = deviceWattHours()
        val total = knownCoverageMs + unknownCoverageMs
        val ratio = if (total > 0) knownCoverageMs.toDouble() / total else null
        return EnergySnapshot(
            schemaVersion = SCHEMA_VERSION,
            byScopeWh = committedWhByScope.toMap(),
            deviceWh = deviceWh,
            deviceScope = deviceScope,
            deviceQuality = deviceQuality,
            knownCoverageMs = knownCoverageMs,
            unknownCoverageMs = unknownCoverageMs,
            coverageRatio = ratio,
            entryCount = entries.size
        )
    }

    fun exportRange(fromMs: Long, toMs: Long): List<EnergySample> =
        entries.values.filter { it.endMs >= fromMs && it.startMs <= toMs }
}
