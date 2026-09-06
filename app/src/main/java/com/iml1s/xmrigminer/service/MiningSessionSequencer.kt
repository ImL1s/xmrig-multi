package com.iml1s.xmrigminer.service

/**
 * Pure Start/Stop session sequencing for MiningController (#124).
 *
 * Encodes the order that must hold regardless of WorkManager / native engine:
 * validate → arm → engine cleanup (no UserStopped) → enqueue.
 * Invalid config must not arm or clear a prior UserStopped latch.
 */
object MiningSessionSequencer {

    sealed interface StartDecision {
        data object ProceedArmAndReplace : StartDecision
        data class Reject(val message: String) : StartDecision
    }

    /**
     * Apply the validated-start latch transition. Call only after config/gates pass.
     * Returns whether UserStopped is clear afterwards (must be true).
     */
    fun onValidatedStartReady(): Boolean {
        MiningSessionLatch.armSession()
        return !MiningSessionLatch.isUserStopped()
    }

    /**
     * Engine replace / internal cleanup before enqueue — must NOT latch UserStopped.
     * Callers cancel workers / kill leftover processes separately.
     */
    fun onEngineReplaceCleanup() {
        // Intentionally no latch mutation.
    }

    /** Explicit user Stop — latches UserStopped. */
    fun onUserStop() {
        MiningSessionLatch.latchUserStop()
    }

    /** Thermal / power / budget pause — not UserStopped. */
    fun onPolicyPause(untilMs: Long = 0L) {
        MiningSessionLatch.latchPolicyPause(untilMs)
    }

    /**
     * Reproduce the historical bug order for regression tests:
     * arm → latchUserStop (as old stop() did) → expect stopped=true.
     */
    fun legacyBuggyStartCleanupOrder(): Boolean {
        MiningSessionLatch.armSession()
        MiningSessionLatch.latchUserStop()
        return MiningSessionLatch.isUserStopped()
    }

    /**
     * Correct order after a successful validation gate.
     * engineCleanupInvoked simulates stopEngine without user latch.
     */
    fun correctStartCleanupOrder(engineCleanupInvoked: () -> Unit): Boolean {
        MiningSessionLatch.armSession()
        engineCleanupInvoked()
        onEngineReplaceCleanup()
        return !MiningSessionLatch.isUserStopped()
    }
}
