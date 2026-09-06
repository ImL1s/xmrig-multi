package com.iml1s.xmrigminer.service

/**
 * Android port of shared/thermal-policy (#38).
 * Battery vs CPU thresholds are separate; unknown/stale/NaN are never "healthy 0°C".
 */
object ThermalPolicy {

    enum class Source { BATTERY, CPU, PACKAGE, OS_STATUS, HEADROOM }
    enum class Quality { OK, STALE, UNKNOWN, UNSUPPORTED, NAN, SENTINEL }
    enum class Phase { ALLOWED, SOFT_THROTTLE, PAUSED, CRITICAL }
    enum class Action { NONE, THROTTLE, PAUSE, CRITICAL_STOP, HOLD, RESUME }

    data class Defaults(
        val batterySoftC: Float = 42f,
        val batteryPauseC: Float = 45f,
        val batteryCriticalC: Float = 50f,
        val batteryResumeC: Float = 40f,
        val cpuSoftC: Float = 80f,
        val cpuPauseC: Float = 90f,
        val cpuCriticalC: Float = 95f,
        val cpuResumeC: Float = 75f,
        val minHoldMs: Long = 30_000L,
        val cooldownMs: Long = 60_000L,
        val staleAfterMs: Long = 120_000L,
        val softThrottleFactor: Float = 0.5f,
        val allowResumeAfterCooldown: Boolean = true
    )

    data class Observation(
        val source: Source,
        val celsius: Float? = null,
        val osStatus: String? = null,
        val headroom: Float? = null,
        val timestampMs: Long,
        val quality: Quality,
        val note: String? = null
    )

    data class State(
        val phase: Phase = Phase.ALLOWED,
        val sinceMs: Long = 0L,
        val cooldownUntilMs: Long? = null,
        val permanentThreads: Int? = null,
        val effectiveThreads: Int? = null
    )

    data class Decision(
        val phase: Phase,
        val action: Action,
        val reasons: List<String>,
        val resumeWhen: String?,
        val effectiveThreads: Int?,
        val permanentProfileUnchanged: Boolean = true,
        val nextState: State,
        val nextEvalAtMs: Long?
    )

    val DEFAULTS = Defaults()

    fun normalizeBatteryTemp(
        rawCelsius: Float?,
        timestampMs: Long,
        nowMs: Long,
        suspectZero: Boolean = false,
        cfg: Defaults = DEFAULTS
    ): Observation {
        if (rawCelsius == null || rawCelsius.isNaN()) {
            return Observation(
                Source.BATTERY, null, null, null, timestampMs,
                if (rawCelsius != null && rawCelsius.isNaN()) Quality.NAN else Quality.UNKNOWN,
                "Temperature reading missing or NaN"
            )
        }
        if (rawCelsius == 0f && suspectZero) {
            return Observation(
                Source.BATTERY, null, null, null, timestampMs, Quality.SENTINEL,
                "0°C sentinel — not treated as healthy"
            )
        }
        val age = nowMs - timestampMs
        if (age > cfg.staleAfterMs) {
            return Observation(
                Source.BATTERY, rawCelsius, null, null, timestampMs, Quality.STALE,
                "Stale by ${age / 1000}s"
            )
        }
        return Observation(Source.BATTERY, rawCelsius, null, null, timestampMs, Quality.OK, null)
    }

    fun evaluate(
        observations: List<Observation>,
        state: State = State(),
        nowMs: Long,
        userStopped: Boolean = false,
        cfg: Defaults = DEFAULTS
    ): Decision {
        if (userStopped) {
            return decision(
                Phase.PAUSED, Action.HOLD,
                listOf("Manual Stop is active — thermal cool-down will not auto-restart"),
                "User must explicitly Start again", 0, state, nowMs, state.cooldownUntilMs, null
            )
        }

        val severity = worstSeverity(observations, cfg)
        val holdRemaining = holdRemaining(state, nowMs, cfg)
        val prevRank = phaseRank(state.phase)
        val sevRank = severity.rank

        if (sevRank >= 3 && sevRank >= prevRank) {
            return decision(
                Phase.CRITICAL,
                if (state.phase == Phase.CRITICAL) Action.HOLD else Action.CRITICAL_STOP,
                severity.reasons, resumeCopy(cfg), 0, state, nowMs, null, nowMs + cfg.minHoldMs
            )
        }
        if (sevRank >= 2 && sevRank >= prevRank) {
            return decision(
                Phase.PAUSED,
                if (state.phase == Phase.PAUSED || state.phase == Phase.CRITICAL) Action.HOLD else Action.PAUSE,
                severity.reasons, resumeCopy(cfg), 0, state, nowMs, null,
                nowMs + maxOf(holdRemaining, cfg.minHoldMs)
            )
        }
        if (sevRank >= 1 && sevRank >= prevRank && prevRank <= 1) {
            val threads = softThreads(state.permanentThreads, cfg)
            return decision(
                Phase.SOFT_THROTTLE,
                if (state.phase == Phase.SOFT_THROTTLE) Action.HOLD else Action.THROTTLE,
                severity.reasons, resumeCopy(cfg), threads, state, nowMs, null,
                nowMs + maxOf(holdRemaining, 5_000L)
            )
        }

        if (state.phase == Phase.ALLOWED) {
            return decision(
                Phase.ALLOWED, Action.NONE,
                severity.reasons.ifEmpty { listOf("Thermal conditions nominal") },
                null, state.permanentThreads, state, nowMs, null, null
            )
        }

        val cooled = belowResume(observations, cfg)
        var cooldownUntil = state.cooldownUntilMs
        if (cooled && cooldownUntil == null) cooldownUntil = nowMs + cfg.cooldownMs
        val stillCooling = cooldownUntil != null && nowMs < cooldownUntil!!

        if (!cooled || holdRemaining > 0 || stillCooling || !cfg.allowResumeAfterCooldown) {
            val why = mutableListOf<String>()
            if (!cooled) why += "Still above resume threshold (hysteresis)"
            if (holdRemaining > 0) why += "Min hold ${holdRemaining / 1000}s remaining"
            if (stillCooling) why += "Cooldown ${(cooldownUntil!! - nowMs) / 1000}s remaining"
            if (!cfg.allowResumeAfterCooldown) why += "Auto-resume after cooldown disabled"
            val holdPhase = if (state.phase == Phase.CRITICAL) Phase.PAUSED else state.phase
            return decision(
                holdPhase, Action.HOLD,
                why.ifEmpty { listOf("Waiting for thermal recovery") },
                resumeCopy(cfg),
                if (holdPhase == Phase.SOFT_THROTTLE) softThreads(state.permanentThreads, cfg) else 0,
                state, nowMs, if (cooled) cooldownUntil else state.cooldownUntilMs,
                nowMs + maxOf(holdRemaining, if (stillCooling) cooldownUntil!! - nowMs else 5_000L)
            )
        }

        return decision(
            Phase.ALLOWED, Action.RESUME,
            listOf("Thermal recovered below resume threshold after cooldown"),
            null, state.permanentThreads, state, nowMs, null, null
        )
    }

    /** Convenience: legacy MonitorWorker single battery reading. */
    fun evaluateBatteryTemp(
        tempC: Float,
        nowMs: Long,
        state: State = State(),
        userStopped: Boolean = false,
        suspectZero: Boolean = tempC == 0f,
        cfg: Defaults = DEFAULTS
    ): Decision {
        val obs = normalizeBatteryTemp(tempC, nowMs, nowMs, suspectZero, cfg)
        return evaluate(listOf(obs), state, nowMs, userStopped, cfg)
    }

    private data class Severity(val rank: Int, val reasons: List<String>)

    private fun worstSeverity(observations: List<Observation>, cfg: Defaults): Severity {
        if (observations.isEmpty()) {
            return Severity(1, listOf("No thermal observations — conservative soft throttle"))
        }
        var rank = 0
        val reasons = mutableListOf<String>()
        for (obs in observations) {
            val s = score(obs, cfg)
            if (s.first > rank) rank = s.first
            s.second?.let { reasons += it }
        }
        return Severity(rank, reasons)
    }

    private fun score(obs: Observation, cfg: Defaults): Pair<Int, String?> {
        when (obs.quality) {
            Quality.UNSUPPORTED, Quality.NAN, Quality.SENTINEL, Quality.UNKNOWN, Quality.STALE ->
                return 1 to (obs.note ?: "Thermal ${obs.source} quality=${obs.quality}")
            Quality.OK -> Unit
        }
        if (obs.source == Source.OS_STATUS) {
            val r = osRank(obs.osStatus)
            return when {
                r >= 4 -> 3 to "OS thermal status ${obs.osStatus} (critical protection)"
                r >= 3 -> 2 to "OS thermal status ${obs.osStatus}"
                r >= 2 -> 1 to "OS thermal status ${obs.osStatus} — soft throttle"
                else -> 0 to null
            }
        }
        if (obs.source == Source.HEADROOM) {
            val h = obs.headroom ?: return 1 to "Headroom missing"
            return when {
                h < 0 -> 3 to "Thermal headroom $h < 0"
                h < 25 -> 2 to "Low thermal headroom ($h)"
                h < 50 -> 1 to "Reduced thermal headroom ($h)"
                else -> 0 to null
            }
        }
        val (soft, pause, critical) = limits(obs.source, cfg)
        val c = obs.celsius ?: return 1 to "${obs.source} temperature missing"
        return when {
            c >= critical -> 3 to "${obs.source} ${c}°C ≥ critical ${critical}°C"
            c >= pause -> 2 to "${obs.source} ${c}°C ≥ pause ${pause}°C"
            c >= soft -> 1 to "${obs.source} ${c}°C ≥ soft ${soft}°C"
            else -> 0 to null
        }
    }

    private fun limits(source: Source, cfg: Defaults): Triple<Float, Float, Float> =
        if (source == Source.CPU || source == Source.PACKAGE) {
            Triple(cfg.cpuSoftC, cfg.cpuPauseC, cfg.cpuCriticalC)
        } else {
            Triple(cfg.batterySoftC, cfg.batteryPauseC, cfg.batteryCriticalC)
        }

    private fun resumeOf(source: Source, cfg: Defaults): Float =
        if (source == Source.CPU || source == Source.PACKAGE) cfg.cpuResumeC else cfg.batteryResumeC

    private fun belowResume(observations: List<Observation>, cfg: Defaults): Boolean {
        if (observations.isEmpty()) return false
        for (obs in observations) {
            if (obs.quality != Quality.OK) return false
            when (obs.source) {
                Source.OS_STATUS -> if (osRank(obs.osStatus) > 1) return false
                Source.HEADROOM -> if ((obs.headroom ?: -1f) < 50f) return false
                else -> {
                    val c = obs.celsius ?: return false
                    if (c > resumeOf(obs.source, cfg)) return false
                }
            }
        }
        return true
    }

    private fun osRank(status: String?): Int = when (status?.lowercase()) {
        "none", "nominal" -> 0
        "light", "fair" -> 1
        "moderate" -> 2
        "severe", "serious" -> 3
        "critical" -> 4
        "emergency" -> 5
        "shutdown" -> 6
        else -> 1
    }

    private fun phaseRank(phase: Phase) = when (phase) {
        Phase.CRITICAL -> 3
        Phase.PAUSED -> 2
        Phase.SOFT_THROTTLE -> 1
        Phase.ALLOWED -> 0
    }

    private fun holdRemaining(state: State, nowMs: Long, cfg: Defaults): Long {
        if (state.phase == Phase.ALLOWED) return 0
        return maxOf(0L, cfg.minHoldMs - (nowMs - state.sinceMs))
    }

    private fun softThreads(permanent: Int?, cfg: Defaults): Int {
        if (permanent == null || permanent <= 0) return 1
        return maxOf(1, (permanent * cfg.softThrottleFactor).toInt())
    }

    private fun resumeCopy(cfg: Defaults) =
        "Cool below resume threshold and wait cooldown (${cfg.cooldownMs / 1000}s)"

    private fun decision(
        phase: Phase,
        action: Action,
        reasons: List<String>,
        resumeWhen: String?,
        effectiveThreads: Int?,
        prev: State,
        nowMs: Long,
        cooldownUntilMs: Long?,
        nextEvalAtMs: Long?
    ): Decision {
        val changed = phase != prev.phase
        return Decision(
            phase = phase,
            action = action,
            reasons = reasons,
            resumeWhen = resumeWhen,
            effectiveThreads = effectiveThreads,
            permanentProfileUnchanged = true,
            nextState = State(
                phase = phase,
                sinceMs = if (changed) nowMs else prev.sinceMs,
                cooldownUntilMs = cooldownUntilMs,
                permanentThreads = prev.permanentThreads,
                effectiveThreads = effectiveThreads ?: prev.effectiveThreads
            ),
            nextEvalAtMs = nextEvalAtMs
        )
    }
}
