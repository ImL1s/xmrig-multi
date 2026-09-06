package com.iml1s.xmrigminer.service

/**
 * Android port of shared/power-policy (#39).
 * Plugged ≠ charging status; manual Stop revision blocks AC/schedule revival.
 */
object PowerPolicy {

    enum class Kind { ALLOWED, WAITING, PAUSED, USER_STOPPED, UNAVAILABLE }
    enum class SuggestedAction { NONE, PAUSE, WAIT, UNAVAILABLE }
    enum class PowerSource { AC, USB, WIRELESS, UNKNOWN }
    enum class ChargingStatus { CHARGING, FULL, NOT_CHARGING, DISCHARGING, UNKNOWN }
    enum class Quality { OK, UNKNOWN, UNAVAILABLE, FAILED }

    data class Defaults(
        val requireExternalPower: Boolean = true,
        val pauseOnUnplug: Boolean = true,
        val chargeToPercentBeforeMine: Int? = 50,
        val minBatteryPercent: Int = 20,
        val resumeBatteryPercent: Int = 30,
        val pauseOnNetDischargeWhilePlugged: Boolean = true,
        val netDischargeThresholdMa: Int = -50,
        val preferUnmetered: Boolean = false,
        val idleAfterMs: Long? = null,
        val maxSessionMs: Long? = null,
        val allowWindows: List<IntRange> = emptyList() // start..end-1 minutes; use custom for cross-midnight
    )

    data class Window(val startMin: Int, val endMin: Int)

    data class Observation(
        val platformHasBattery: Boolean = true,
        val batteryApiAvailable: Boolean = true,
        val externalPowerPresent: Boolean? = null,
        val powerSource: PowerSource? = null,
        val chargingStatus: ChargingStatus = ChargingStatus.UNKNOWN,
        val socPercent: Int? = null,
        val batteryTempC: Float? = null,
        val netBatteryFlowMa: Int? = null,
        val quality: Quality = Quality.OK,
        val note: String? = null,
        val timestampMs: Long = 0L
    )

    data class Intent(
        val automationArmed: Boolean = false,
        val userStopRevision: Int = 0,
        val sessionArmedRevision: Int = 0,
        val pauseUntilNextPlug: Boolean = false,
        val wasPluggedWhenPaused: Boolean = false,
        val batteryPaused: Boolean = false
    )

    data class Network(val metered: Boolean = false, val available: Boolean = true)
    data class Idle(val idleMs: Long = 0)
    data class Session(val startedAtMs: Long? = null, val elapsedMs: Long = 0)

    data class Verdict(
        val kind: Kind,
        val reasons: List<String>,
        val resumeWhen: String?,
        val nextEvalAtMs: Long?,
        val preservesSessionData: Boolean = true,
        val suggestedAction: SuggestedAction,
        val nextIntent: Intent
    )

    val DEFAULTS = Defaults()

    fun latchUserStop(intent: Intent): Intent = intent.copy(
        userStopRevision = intent.userStopRevision + 1,
        automationArmed = false,
        pauseUntilNextPlug = false
    )

    fun armSession(intent: Intent, automationArmed: Boolean = false): Intent = intent.copy(
        sessionArmedRevision = intent.userStopRevision,
        automationArmed = automationArmed,
        pauseUntilNextPlug = false,
        batteryPaused = false
    )

    fun isEffectivelyPlugged(obs: Observation): Boolean {
        if (obs.externalPowerPresent == true) return true
        if (obs.externalPowerPresent == false) return false
        return obs.chargingStatus == ChargingStatus.CHARGING
    }

    fun evaluate(
        observation: Observation,
        intent: Intent = Intent(),
        config: Defaults = DEFAULTS,
        network: Network = Network(),
        idle: Idle = Idle(),
        session: Session = Session(),
        nowMs: Long,
        minuteOfDay: Int? = null,
        windows: List<Window> = emptyList()
    ): Verdict {
        if (intent.userStopRevision > intent.sessionArmedRevision) {
            return verdict(
                Kind.USER_STOPPED,
                listOf("Manual Stop is latched — AC plug, schedule, or cooldown cannot revive mining"),
                "Explicit Start or re-arm automation",
                null, SuggestedAction.PAUSE, intent
            )
        }

        if (observation.quality == Quality.UNAVAILABLE) {
            if (!observation.platformHasBattery) {
                return finishNonBattery(config, nowMs, intent, network, idle, session, minuteOfDay, windows)
            }
            return verdict(
                Kind.UNAVAILABLE,
                listOf(observation.note ?: "Battery API unavailable"),
                "Platform with trusted battery/power APIs",
                null, SuggestedAction.UNAVAILABLE, intent
            )
        }

        if (observation.quality == Quality.FAILED || observation.quality == Quality.UNKNOWN) {
            return verdict(
                Kind.WAITING,
                listOf(observation.note ?: "Battery signals unknown — waiting conservatively"),
                "Valid battery observation",
                nowMs + 30_000, SuggestedAction.WAIT, intent
            )
        }

        var nextIntent = intent
        val plugged = isEffectivelyPlugged(observation)

        if (intent.pauseUntilNextPlug) {
            if (intent.wasPluggedWhenPaused && !plugged) {
                nextIntent = nextIntent.copy(wasPluggedWhenPaused = false)
            }
            if (!nextIntent.wasPluggedWhenPaused && plugged) {
                nextIntent = nextIntent.copy(pauseUntilNextPlug = false, wasPluggedWhenPaused = false)
            } else {
                return verdict(
                    Kind.WAITING,
                    listOf("Paused until next plug cycle"),
                    "Unplug then plug external power",
                    nowMs + 15_000, SuggestedAction.WAIT, nextIntent
                )
            }
        }

        val schedWindows = windows.ifEmpty {
            config.allowWindows.map { Window(it.first, it.last + 1) }
        }
        val sched = evaluateSchedule(nowMs, schedWindows, minuteOfDay)
        if (!sched.first) {
            return verdict(
                Kind.WAITING, listOf(sched.second ?: "Outside schedule"),
                "Next allowed schedule window", sched.third, SuggestedAction.WAIT, nextIntent
            )
        }

        if (config.idleAfterMs != null && intent.automationArmed && idle.idleMs < config.idleAfterMs) {
            return verdict(
                Kind.WAITING,
                listOf("Idle ${idle.idleMs}ms < required ${config.idleAfterMs}ms"),
                "Device idle for ${config.idleAfterMs}ms",
                nowMs + 1_000, SuggestedAction.WAIT, nextIntent
            )
        }

        if (config.preferUnmetered && network.metered) {
            return verdict(
                Kind.WAITING, listOf("Metered network — prefer unmetered enabled"),
                "Unmetered / Wi‑Fi connection", nowMs + 30_000, SuggestedAction.WAIT, nextIntent
            )
        }
        if (!network.available) {
            return verdict(
                Kind.PAUSED, listOf("Network unavailable"),
                "Network restored", nowMs + 15_000, SuggestedAction.PAUSE, nextIntent
            )
        }

        val elapsed = session.elapsedMs
        if (config.maxSessionMs != null && elapsed >= config.maxSessionMs) {
            return verdict(
                Kind.PAUSED, listOf("Max session ${config.maxSessionMs}ms reached"),
                "New user-started session", null, SuggestedAction.PAUSE, nextIntent
            )
        }

        if (config.requireExternalPower || config.pauseOnUnplug) {
            if (!plugged) {
                val reason = if (observation.chargingStatus == ChargingStatus.FULL) {
                    "Battery FULL but not plugged — not treated as on charger"
                } else {
                    "External power not present"
                }
                return verdict(
                    Kind.PAUSED, listOf(reason),
                    "Plug AC/USB/wireless power", nowMs + 15_000, SuggestedAction.PAUSE, nextIntent
                )
            }
        }

        val chargeTarget = config.chargeToPercentBeforeMine
        val soc = observation.socPercent
        if (chargeTarget != null && plugged && soc != null && soc < chargeTarget) {
            return verdict(
                Kind.WAITING,
                listOf("Charging first: SOC $soc% < target $chargeTarget%"),
                "Reach $chargeTarget% while plugged (then mine)",
                nowMs + 30_000, SuggestedAction.WAIT, nextIntent
            )
        }

        val flow = observation.netBatteryFlowMa
        if (config.pauseOnNetDischargeWhilePlugged && plugged && flow != null &&
            flow <= config.netDischargeThresholdMa
        ) {
            return verdict(
                Kind.PAUSED,
                listOf("Sustained net discharge while plugged ($flow mA)"),
                "Charger supplying net positive current",
                nowMs + 60_000, SuggestedAction.PAUSE, nextIntent
            )
        }

        if (!plugged && soc != null) {
            val low = soc < config.minBatteryPercent
            if (low || (intent.batteryPaused && soc < config.resumeBatteryPercent)) {
                return verdict(
                    Kind.PAUSED,
                    listOf(
                        if (low) "Battery $soc% < min ${config.minBatteryPercent}%"
                        else "Battery $soc% < resume ${config.resumeBatteryPercent}% (hysteresis)"
                    ),
                    "Charge to ≥ ${config.resumeBatteryPercent}%",
                    nowMs + 30_000, SuggestedAction.PAUSE, nextIntent.copy(batteryPaused = true)
                )
            }
        }

        return verdict(
            Kind.ALLOWED, listOf("Power policy satisfied"),
            null, sched.third, SuggestedAction.NONE, nextIntent.copy(batteryPaused = false)
        )
    }

    /** Minutes-of-day schedule; cross-midnight supported. */
    fun inWindow(minuteOfDay: Int, startMin: Int, endMin: Int): Boolean {
        val m = ((minuteOfDay % 1440) + 1440) % 1440
        val s = ((startMin % 1440) + 1440) % 1440
        val e = ((endMin % 1440) + 1440) % 1440
        if (s == e) return true
        return if (s < e) m in s until e else m >= s || m < e
    }

    private fun evaluateSchedule(
        nowMs: Long,
        windows: List<Window>,
        minuteOfDay: Int?
    ): Triple<Boolean, String?, Long?> {
        if (windows.isEmpty()) return Triple(true, null, null)
        val mod = minuteOfDay ?: run {
            val d = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"))
            d.timeInMillis = nowMs
            d.get(java.util.Calendar.HOUR_OF_DAY) * 60 + d.get(java.util.Calendar.MINUTE)
        }
        for (w in windows) {
            if (inWindow(mod, w.startMin, w.endMin)) {
                val mins = ((w.endMin - mod) + 1440) % 1440
                return Triple(true, null, nowMs + mins * 60_000L)
            }
        }
        var best: Int? = null
        for (w in windows) {
            val mins = ((w.startMin - mod) + 1440) % 1440
            if (best == null || mins < best) best = mins
        }
        return Triple(false, "Outside allowed schedule (minute-of-day=$mod)", best?.let { nowMs + it * 60_000L })
    }

    private fun finishNonBattery(
        config: Defaults,
        nowMs: Long,
        intent: Intent,
        network: Network,
        idle: Idle,
        session: Session,
        minuteOfDay: Int?,
        windows: List<Window>
    ): Verdict {
        val sched = evaluateSchedule(nowMs, windows, minuteOfDay)
        if (!sched.first) {
            return verdict(Kind.WAITING, listOf(sched.second!!), "Next allowed schedule window",
                sched.third, SuggestedAction.WAIT, intent)
        }
        if (config.preferUnmetered && network.metered) {
            return verdict(Kind.WAITING, listOf("Metered network — prefer unmetered enabled"),
                "Unmetered connection", nowMs + 30_000, SuggestedAction.WAIT, intent)
        }
        if (!network.available) {
            return verdict(Kind.PAUSED, listOf("Network unavailable"),
                "Network restored", nowMs + 15_000, SuggestedAction.PAUSE, intent)
        }
        if (config.maxSessionMs != null && session.elapsedMs >= config.maxSessionMs) {
            return verdict(Kind.PAUSED, listOf("Max session reached"),
                "New user-started session", null, SuggestedAction.PAUSE, intent)
        }
        return verdict(
            Kind.ALLOWED, listOf("No battery — power limits not applicable; other policies OK"),
            null, sched.third, SuggestedAction.NONE, intent
        )
    }

    private fun verdict(
        kind: Kind,
        reasons: List<String>,
        resumeWhen: String?,
        nextEvalAtMs: Long?,
        action: SuggestedAction,
        intent: Intent
    ) = Verdict(kind, reasons, resumeWhen, nextEvalAtMs, true, action, intent)
}
