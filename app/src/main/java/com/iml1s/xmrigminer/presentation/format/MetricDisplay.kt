package com.iml1s.xmrigminer.presentation.format

import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * How much trust a displayed number deserves (#54).
 *
 * The old home screen collapsed every one of these into `0`, so a miner that had not yet
 * produced a sample looked identical to one reporting a genuine zero. Keeping the distinction
 * in the type means the UI cannot accidentally launder an unknown into a value.
 */
enum class MetricQuality {
    /** Read from the engine or the OS. */
    MEASURED,

    /** Derived from a measurement rather than observed directly. */
    ESTIMATED,

    /** The source exists and is running, but has not produced a sample yet. */
    PENDING,

    /** No sensor, no permission, or the platform cannot supply this at all. */
    UNAVAILABLE,

    /** Last known value, older than its sampling window. */
    STALE
}

/**
 * A formatted metric plus the confidence attached to it.
 *
 * @param text what to render. Always non-blank; [PLACEHOLDER] when there is no number to show.
 * @param hasValue false when [text] is only a placeholder, so callers can style it as absent.
 */
data class MetricReading(
    val text: String,
    val quality: MetricQuality,
    val hasValue: Boolean
) {
    companion object {
        /** En dash, not "0" and not an empty string, so screen readers announce something. */
        const val PLACEHOLDER = "–"

        fun of(text: String, quality: MetricQuality = MetricQuality.MEASURED) =
            MetricReading(text, quality, hasValue = true)

        fun absent(quality: MetricQuality) =
            MetricReading(PLACEHOLDER, quality, hasValue = false)
    }
}

/**
 * Pure formatting for everything the home screen shows.
 *
 * Kept free of Android types so the boundary cases that matter — NaN, negatives, "running but
 * no sample yet", genuine zero — are covered by plain JVM tests. Quality *wording* is resolved
 * by the composable from string resources; only units and numerals are decided here so that
 * protocol-facing numbers never pick up locale decimal separators (#59).
 */
object MetricFormat {

    private val NUMERIC: Locale = Locale.US

    /**
     * Hashrate in SI steps. A running miner with no sample yet is [MetricQuality.PENDING];
     * a stopped miner has nothing to report rather than "0.00 H/s".
     */
    fun hashrate(value: Double?, isRunning: Boolean): MetricReading {
        if (value == null || value.isNaN() || value.isInfinite() || value < 0.0) {
            return MetricReading.absent(
                if (isRunning) MetricQuality.PENDING else MetricQuality.UNAVAILABLE
            )
        }
        if (value == 0.0) {
            // XMRig reports 0 before the first window closes; only a stopped miner means "none".
            return if (isRunning) {
                MetricReading.absent(MetricQuality.PENDING)
            } else {
                MetricReading.absent(MetricQuality.UNAVAILABLE)
            }
        }
        return MetricReading.of(hashrateText(value), MetricQuality.MEASURED)
    }

    /** Bare hashrate text without the trust wrapper, for labels that already state their scope. */
    fun hashrateText(value: Double): String = when {
        abs(value) >= 1_000_000.0 -> String.format(NUMERIC, "%.2f MH/s", value / 1_000_000.0)
        abs(value) >= 1_000.0 -> String.format(NUMERIC, "%.2f kH/s", value / 1_000.0)
        abs(value) >= 100.0 -> String.format(NUMERIC, "%.1f H/s", value)
        else -> String.format(NUMERIC, "%.2f H/s", value)
    }

    /** Accepted / rejected as a ledger. Always measured: the counters are authoritative. */
    fun shareLedger(accepted: Int, rejected: Int): MetricReading =
        MetricReading.of("$accepted / $rejected", MetricQuality.MEASURED)

    /**
     * Share success rate. With no shares submitted there is no rate — the previous screen
     * printed "0.0%", which reads as "every share was rejected".
     */
    fun shareSuccessRate(accepted: Int, rejected: Int): MetricReading {
        val total = accepted + rejected
        if (total <= 0 || accepted < 0 || rejected < 0) {
            return MetricReading.absent(MetricQuality.UNAVAILABLE)
        }
        val pct = accepted.toDouble() / total * 100.0
        return MetricReading.of(String.format(NUMERIC, "%.1f%%", pct), MetricQuality.MEASURED)
    }

    /** Device temperature. A missing sensor reports 0, which is not 0 °C. */
    fun temperature(celsius: Float?): MetricReading {
        if (celsius == null || celsius.isNaN() || celsius <= 0f || celsius > 150f) {
            return MetricReading.absent(MetricQuality.UNAVAILABLE)
        }
        return MetricReading.of(String.format(NUMERIC, "%.1f °C", celsius), MetricQuality.MEASURED)
    }

    /**
     * CPU share of the app process.
     *
     * The collector samples the app's own PID rather than the XMRig child, so this is app-scope
     * and the caller must label it as such until #54 fixes the source. Deliberately not called
     * "CPU usage".
     */
    fun processCpuPercent(percent: Float?, isRunning: Boolean): MetricReading {
        if (percent == null || percent.isNaN() || percent < 0f) {
            return MetricReading.absent(
                if (isRunning) MetricQuality.PENDING else MetricQuality.UNAVAILABLE
            )
        }
        if (percent == 0f) {
            return if (isRunning) {
                MetricReading.absent(MetricQuality.PENDING)
            } else {
                MetricReading.absent(MetricQuality.UNAVAILABLE)
            }
        }
        val clamped = percent.coerceAtMost(100f)
        return MetricReading.of("${clamped.roundToInt()}%", MetricQuality.ESTIMATED)
    }

    /** Battery level. Out-of-range readings are unknown, not clamped into a plausible number. */
    fun battery(levelPercent: Int?): MetricReading {
        if (levelPercent == null || levelPercent !in 0..100) {
            return MetricReading.absent(MetricQuality.UNAVAILABLE)
        }
        return MetricReading.of("$levelPercent%", MetricQuality.MEASURED)
    }

    /** Pool difficulty; zero means the pool has not sent a job yet. */
    fun difficulty(value: Long?): MetricReading {
        if (value == null || value <= 0L) return MetricReading.absent(MetricQuality.UNAVAILABLE)
        return MetricReading.of(groupDigits(value), MetricQuality.MEASURED)
    }

    /** Elapsed run time as H:MM:SS. Negative input is a clock problem, not a duration. */
    fun uptime(seconds: Long?): MetricReading {
        if (seconds == null || seconds < 0L) return MetricReading.absent(MetricQuality.UNAVAILABLE)
        val h = seconds / 3600
        val m = (seconds % 3600) / 60
        val s = seconds % 60
        return MetricReading.of(String.format(NUMERIC, "%d:%02d:%02d", h, m, s), MetricQuality.MEASURED)
    }

    /**
     * Requested versus available threads (#31).
     *
     * XMRig may run fewer threads than asked for when cache or memory is short, so this reads
     * as a request against a ceiling rather than a promise. It is not the effective count —
     * that needs an engine read-back.
     */
    fun threadRequest(requested: Int?, availableCores: Int): MetricReading {
        if (requested == null || requested <= 0 || availableCores <= 0) {
            return MetricReading.absent(MetricQuality.UNAVAILABLE)
        }
        return MetricReading.of("$requested / $availableCores", MetricQuality.MEASURED)
    }

    private fun groupDigits(value: Long): String {
        val digits = value.toString()
        val out = StringBuilder()
        for ((i, c) in digits.withIndex()) {
            if (i > 0 && (digits.length - i) % 3 == 0) out.append(' ')
            out.append(c)
        }
        return out.toString()
    }
}
