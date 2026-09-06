package com.iml1s.xmrigminer.service

/**
 * Android port of shared/automation-policy (#73).
 */
object AutomationPolicy {
    enum class Kind { ALLOWED, WAITING, PAUSED, USER_STOPPED, UNAVAILABLE }
    enum class Action { NONE, PAUSE, WAIT, UNAVAILABLE }
    enum class EconomicGoal { EFFICIENCY, PROFIT_ONLY, HOBBY }

    data class Defaults(
        val economicGoal: EconomicGoal = EconomicGoal.HOBBY,
        val dailySpendCapFiat: Double? = null,
        val monthlySpendCapFiat: Double? = null,
        val dailyKwhCap: Double? = null,
        val sessionMaxMs: Long? = null,
        val minReserveSocPercent: Int? = null
    )

    data class Intent(
        val automationArmed: Boolean = false,
        val userStopRevision: Int = 0,
        val sessionArmedRevision: Int = 0,
        val pauseUntilNextPlug: Boolean = false
    )

    data class Gate(val kind: String, val reasons: List<String> = emptyList())
    data class OsGate(val coldStartAllowed: Boolean = true, val reasons: List<String> = emptyList())
    data class Budget(
        val spentFiatToday: Double? = null,
        val spentFiatMonth: Double? = null,
        val kwhToday: Double? = null,
        val sessionElapsedMs: Long? = null,
        val socPercent: Int? = null
    )
    data class Economy(val netFiat: Double? = null, val netQuality: String = "unknown")

    data class Verdict(
        val kind: Kind,
        val reasons: List<String>,
        val suggestedAction: Action,
        val nextIntent: Intent,
        val startsMiner: Boolean = false,
        val simulated: Boolean = false
    )

    fun latchUserStop(intent: Intent) = intent.copy(
        userStopRevision = intent.userStopRevision + 1,
        automationArmed = false,
        pauseUntilNextPlug = false
    )

    fun armAutomation(intent: Intent) = intent.copy(
        sessionArmedRevision = intent.userStopRevision,
        automationArmed = true,
        pauseUntilNextPlug = false
    )

    fun evaluate(
        intent: Intent,
        config: Defaults = Defaults(),
        power: Gate = Gate("Allowed"),
        thermal: Gate = Gate("Allowed"),
        os: OsGate = OsGate(),
        budget: Budget = Budget(),
        economy: Economy = Economy(),
        manualStart: Boolean = false
    ): Verdict {
        if (intent.userStopRevision > intent.sessionArmedRevision) {
            return Verdict(
                Kind.USER_STOPPED,
                listOf("Manual Stop latched — plug/cool-down/budget reset cannot revive"),
                Action.PAUSE,
                intent
            )
        }
        if (!intent.automationArmed && !manualStart) {
            return Verdict(Kind.WAITING, listOf("Automation not armed — explicit enable required"), Action.WAIT, intent)
        }
        if (!os.coldStartAllowed) {
            return Verdict(
                Kind.UNAVAILABLE,
                os.reasons.ifEmpty { listOf("OS cold start not permitted") },
                Action.UNAVAILABLE,
                intent
            )
        }
        if (thermal.kind == "Paused" || thermal.kind == "Unavailable") {
            return Verdict(Kind.PAUSED, thermal.reasons.ifEmpty { listOf("Thermal block") }, Action.PAUSE, intent)
        }
        when (power.kind) {
            "UserStopped" -> return Verdict(Kind.USER_STOPPED, power.reasons, Action.PAUSE, intent)
            "Paused" -> return Verdict(Kind.PAUSED, power.reasons, Action.PAUSE, intent)
            "Waiting" -> return Verdict(Kind.WAITING, power.reasons, Action.WAIT, intent)
            "Unavailable" -> return Verdict(Kind.UNAVAILABLE, power.reasons, Action.UNAVAILABLE, intent)
        }
        if (intent.pauseUntilNextPlug) {
            return Verdict(Kind.WAITING, listOf("Paused until next plug (explicit re-auth)"), Action.WAIT, intent)
        }

        budgetHit(budget, config)?.let {
            return Verdict(Kind.PAUSED, listOf(it), Action.PAUSE, intent)
        }

        if (config.economicGoal == EconomicGoal.PROFIT_ONLY) {
            if (economy.netQuality == "unknown" || economy.netFiat == null) {
                return Verdict(
                    Kind.WAITING,
                    listOf("Profit-only: net estimate unknown — will not assume profitable"),
                    Action.WAIT,
                    intent
                )
            }
            if (economy.netFiat <= 0.0) {
                return Verdict(
                    Kind.PAUSED,
                    listOf("Profit-only: estimated net ${economy.netFiat} ≤ 0"),
                    Action.PAUSE,
                    intent
                )
            }
        }

        return Verdict(Kind.ALLOWED, listOf("All automation gates passed"), Action.NONE, intent)
    }

    private fun budgetHit(budget: Budget, config: Defaults): String? {
        val daily = config.dailySpendCapFiat
        if (daily != null && budget.spentFiatToday != null && budget.spentFiatToday >= daily) {
            return "Daily spend cap reached (spent ${budget.spentFiatToday})"
        }
        val monthly = config.monthlySpendCapFiat
        if (monthly != null && budget.spentFiatMonth != null && budget.spentFiatMonth >= monthly) {
            return "Monthly spend cap reached (${budget.spentFiatMonth})"
        }
        val kwh = config.dailyKwhCap
        if (kwh != null && budget.kwhToday != null && budget.kwhToday >= kwh) {
            return "Daily kWh cap reached (${budget.kwhToday})"
        }
        val session = config.sessionMaxMs
        if (session != null && budget.sessionElapsedMs != null && budget.sessionElapsedMs >= session) {
            return "Session time cap reached"
        }
        val soc = config.minReserveSocPercent
        if (soc != null && budget.socPercent != null && budget.socPercent < soc) {
            return "Battery reserve ${budget.socPercent}% < $soc%"
        }
        return null
    }
}
