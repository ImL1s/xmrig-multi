package com.iml1s.xmrigminer.data.hardware

/**
 * Auto-tune service skeleton (#34/#128).
 * Full measured search lives in shared/auto-tune (JS contract). Android must not
 * invent synthetic H/s as measured — use [uncalibratedSuggestion] until a native
 * offline benchmark adapter is wired and user-accepted.
 */
object AutoTuneService {

    enum class Goal { QUIET, POWER, BALANCED, MAX_SUSTAINED }

    data class Candidate(val id: String, val threads: Int, val randomxMode: String)

    data class Recommendation(
        val threads: Int,
        val randomxMode: String,
        val reason: String,
        val confidence: String,
        val improvementPct: Double? = null
    )

    data class TuneResult(
        val phase: String,
        val ok: Boolean,
        val accepted: Boolean,
        val recommendation: Recommendation?,
        val fingerprintHash: String?,
        val warnings: List<String>,
        val claimsMeasuredHashesPerWatt: Boolean,
        val claimsMeasuredQuiet: Boolean,
        val quietUsesLoadProxy: Boolean,
        val rollbackThreads: Int?,
        val rollbackRandomxMode: String?
    )

    /**
     * Conservative uncalibrated suggestion (no fake measured H/s).
     */
    fun uncalibratedSuggestion(snapshot: HardwareSnapshot?): TuneResult {
        val rec = HardwareProbe.recommendThreads(
            snapshot ?: return TuneResult(
                phase = "idle",
                ok = false,
                accepted = false,
                recommendation = Recommendation(1, "light", "no snapshot", "low"),
                fingerprintHash = null,
                warnings = listOf("no hardware snapshot — skip or use conservative defaults"),
                claimsMeasuredHashesPerWatt = false,
                claimsMeasuredQuiet = false,
                quietUsesLoadProxy = true,
                rollbackThreads = null,
                rollbackRandomxMode = null
            )
        )
        return TuneResult(
            phase = "idle",
            ok = false,
            accepted = false,
            recommendation = Recommendation(
                threads = rec.recommendedThreads,
                randomxMode = rec.randomxModeHint,
                reason = "uncalibrated conservative suggestion",
                confidence = rec.confidence
            ),
            fingerprintHash = fingerprint(snapshot, "unknown", "rx/0"),
            warnings = listOf("not calibrated — suggestion only; user may skip") + rec.reasons,
            claimsMeasuredHashesPerWatt = false,
            claimsMeasuredQuiet = false,
            quietUsesLoadProxy = true,
            rollbackThreads = null,
            rollbackRandomxMode = null
        )
    }

    fun fingerprint(snapshot: HardwareSnapshot, engineBuild: String, algorithm: String): String {
        val parts = listOf(
            snapshot.cpu.logical.value?.toString() ?: "?",
            snapshot.cpu.physical.value?.toString() ?: "?",
            snapshot.cpu.allowed.value?.toString() ?: "?",
            snapshot.memory.totalBytes.value?.toString() ?: "?",
            engineBuild,
            algorithm
        )
        return parts.joinToString("|").hashCode().toUInt().toString(16)
    }

    fun isStale(savedHash: String?, currentHash: String?): Boolean {
        if (savedHash.isNullOrBlank() || currentHash.isNullOrBlank()) return true
        return savedHash != currentHash
    }

    /**
     * Accept only when fingerprint matches; never blind-apply after topology/engine change.
     */
    fun accept(result: TuneResult, currentFingerprint: String?): Pair<Boolean, Recommendation?> {
        if (!result.ok || result.recommendation == null) return false to null
        if (isStale(result.fingerprintHash, currentFingerprint)) return false to null
        return true to result.recommendation
    }

    fun buildSafeCandidates(
        snapshot: HardwareSnapshot,
        goal: Goal = Goal.BALANCED,
        lockedThreads: Int? = null,
        lockedRandomxMode: String? = null
    ): List<Candidate> {
        val max = (snapshot.cpu.allowed.value ?: snapshot.cpu.logical.value ?: 1).coerceAtLeast(1)
        val threads = linkedSetOf<Int>()
        if (lockedThreads != null) {
            threads += lockedThreads.coerceIn(1, max)
        } else {
            threads += 1
            if (max >= 2) threads += (max / 2).coerceAtLeast(1)
            if (max >= 3) threads += max - 1
            if (goal != Goal.QUIET && goal != Goal.POWER) threads += max
        }
        val modes = linkedSetOf<String>()
        if (lockedRandomxMode != null) {
            modes += lockedRandomxMode
        } else {
            val sel = RandomXMemoryBudget.select(
                requestedMode = "auto",
                threads = threads.maxOrNull() ?: 1,
                availableBytes = snapshot.memory.availableBytes.value,
                totalBytes = snapshot.memory.totalBytes.value
            )
            modes += sel.appliedMode ?: "light"
            modes += "light"
        }
        val out = mutableListOf<Candidate>()
        for (t in threads) {
            for (m in modes) {
                out += Candidate("t$t-$m", t, m)
            }
        }
        return out.take(12)
    }
}
