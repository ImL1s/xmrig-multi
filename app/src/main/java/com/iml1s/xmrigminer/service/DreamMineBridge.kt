package com.iml1s.xmrigminer.service

/**
 * Bridges DreamService → shared [MiningController] without embedding engine (#127).
 * Preview / stop never call [requestStart]. Stop only clears dream-scoped ack — never user Stop.
 */
object DreamMineBridge {

    data class Outcome(
        val requested: Boolean,
        val accepted: Boolean,
        val rejectReason: String?
    )

    fun shouldRequest(
        decision: DreamMiningPolicy.Decision,
        alreadyRequestedThisDream: Boolean
    ): Boolean = decision.mayRequestMine && !alreadyRequestedThisDream

    fun afterControllerResult(result: MiningStartResult): Pair<Boolean, Outcome> {
        return when (result) {
            is MiningStartResult.Started ->
                true to Outcome(requested = true, accepted = true, rejectReason = null)
            is MiningStartResult.InvalidConfig ->
                // Allow a later dream tick to retry (e.g. still charging to target).
                false to Outcome(
                    requested = true,
                    accepted = false,
                    rejectReason = result.message
                )
        }
    }
}
