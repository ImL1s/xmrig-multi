package com.iml1s.xmrigminer.service

/**
 * Maps [AutomationPolicy] budget verdicts to a real miner pause (#130).
 * Deleting this call site must make consumer tests fail.
 */
object EnergyBudgetActuator {

    data class Outcome(
        val paused: Boolean,
        val reason: String?,
        val kind: AutomationPolicy.Kind,
        val pauseInvoked: Boolean
    )

    /**
     * @param pauseMiner must call the session owner's policy pause (not UserStopped).
     */
    fun apply(
        verdict: AutomationPolicy.Verdict,
        pauseMiner: (reason: String) -> Unit
    ): Outcome {
        return when (verdict.kind) {
            AutomationPolicy.Kind.ALLOWED -> Outcome(
                paused = false,
                reason = null,
                kind = verdict.kind,
                pauseInvoked = false
            )
            AutomationPolicy.Kind.USER_STOPPED,
            AutomationPolicy.Kind.PAUSED,
            AutomationPolicy.Kind.WAITING,
            AutomationPolicy.Kind.UNAVAILABLE -> {
                val reason = verdict.reasons.firstOrNull() ?: "Energy budget gate"
                pauseMiner(reason)
                Outcome(
                    paused = true,
                    reason = reason,
                    kind = verdict.kind,
                    pauseInvoked = true
                )
            }
        }
    }

    /** Pre-start gate: return block message or null when start may proceed. */
    fun startBlockReason(verdict: AutomationPolicy.Verdict): String? {
        return when (verdict.kind) {
            AutomationPolicy.Kind.ALLOWED -> null
            else -> verdict.reasons.firstOrNull() ?: "Energy budget blocked start"
        }
    }
}
