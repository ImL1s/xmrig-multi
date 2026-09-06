package com.iml1s.xmrigminer.service

/**
 * Dream-scoped mine session (#127). Pure logic — no Android DreamService dependency.
 * Stop/cancel must flip [stillDreaming] before awaiting [startMining].
 */
class DreamMineSession(
    private val startMining: suspend () -> MiningStartResult,
    private val stillDreaming: () -> Boolean
) {
    var requestCount: Int = 0
        private set
    var acceptedCount: Int = 0
        private set
    var lastRejectReason: String? = null
        private set
    var requestedThisDream: Boolean = false
        private set

    fun onDreamStopped() {
        requestedThisDream = false
        lastRejectReason = null
    }

    suspend fun maybeRequest(decision: DreamMiningPolicy.Decision): DreamMineBridge.Outcome? {
        if (!DreamMineBridge.shouldRequest(decision, requestedThisDream)) return null
        if (!stillDreaming()) return null
        requestedThisDream = true
        requestCount++
        // Re-check after marking request — stop may have raced in.
        if (!stillDreaming()) {
            requestedThisDream = false
            return DreamMineBridge.Outcome(
                requested = false,
                accepted = false,
                rejectReason = "Dream stopped before mine request"
            )
        }
        val result = startMining()
        if (!stillDreaming()) {
            // Dream ended during start — do not keep dream-scoped ack; do not user-stop.
            requestedThisDream = false
            lastRejectReason = "Dream stopped during mine request"
            return DreamMineBridge.Outcome(
                requested = true,
                accepted = false,
                rejectReason = lastRejectReason
            )
        }
        val (keep, outcome) = DreamMineBridge.afterControllerResult(result)
        requestedThisDream = keep
        lastRejectReason = outcome.rejectReason
        if (outcome.accepted) acceptedCount++
        return outcome
    }
}
