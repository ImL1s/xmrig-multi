package com.iml1s.xmrigminer.service

/**
 * DreamService mining gate (#76).
 * Preview never mines; formal dream may only request the shared controller when eligible.
 */
object DreamMiningPolicy {
    enum class Phase { PREVIEW, DREAMING, STOPPED }

    data class Decision(
        val phase: Phase,
        val mayRequestMine: Boolean,
        val showClock: Boolean,
        val reasons: List<String>
    )

    /**
     * @param userOptedInClockAndMine user explicitly enabled "standby clock may mine"
     * @param powerAllows shared #39 power gate
     * @param runtimeEligible shared #61 cold-start / FGS eligibility
     * @param userStopped latched Stop
     */
    fun decide(
        phase: Phase,
        userOptedInClockAndMine: Boolean,
        powerAllows: Boolean,
        runtimeEligible: Boolean,
        userStopped: Boolean
    ): Decision {
        if (phase == Phase.PREVIEW || phase == Phase.STOPPED) {
            return Decision(
                phase = phase,
                mayRequestMine = false,
                showClock = true,
                reasons = listOf(
                    if (phase == Phase.PREVIEW) "Preview never starts mining"
                    else "Dream stopped"
                )
            )
        }
        if (userStopped) {
            return Decision(phase, false, true, listOf("User Stop latched — dream will not revive mining"))
        }
        if (!userOptedInClockAndMine) {
            return Decision(phase, false, true, listOf("Clock-only dream — mining not opted in"))
        }
        if (!powerAllows) {
            return Decision(phase, false, true, listOf("Power/policy waiting — clock only"))
        }
        if (!runtimeEligible) {
            return Decision(phase, false, true, listOf("OS/runtime not eligible for background start — clock only"))
        }
        return Decision(
            phase,
            mayRequestMine = true,
            showClock = true,
            reasons = listOf("Eligible — request shared MiningController only (no direct engine start)")
        )
    }
}
