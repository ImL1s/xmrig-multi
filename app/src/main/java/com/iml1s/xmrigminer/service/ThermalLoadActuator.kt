package com.iml1s.xmrigminer.service

/**
 * Separates thermal policy decisions from engine load changes (#125).
 *
 * Effective threads are **pending** until the engine adapter reports applied.
 * Failures must not claim throttle succeeded — callers should policy-pause.
 */
object ThermalLoadActuator {

    enum class Status { IDLE, PENDING, APPLIED, FAILED, UNSUPPORTED }

    data class Command(
        val requestedThreads: Int,
        val permanentThreads: Int?,
        val sessionGeneration: Long,
        val reason: String
    )

    data class Outcome(
        val status: Status,
        val requestedThreads: Int?,
        val appliedThreads: Int?,
        val message: String,
        val shouldPauseSafely: Boolean = false
    )

    /**
     * Record a throttle request. [engineApply] returns applied thread count or null on failure.
     * Permanent profile must remain unchanged in DataStore — only runtime override.
     */
    fun applySoftThrottle(
        requestedThreads: Int,
        permanentThreads: Int?,
        sessionGeneration: Long,
        reason: String,
        engineSupportsHotApply: Boolean,
        engineApply: (Command) -> Int?
    ): Outcome {
        if (requestedThreads <= 0) {
            return Outcome(
                status = Status.FAILED,
                requestedThreads = requestedThreads,
                appliedThreads = null,
                message = "Invalid throttle threads $requestedThreads",
                shouldPauseSafely = true
            )
        }
        if (permanentThreads != null && requestedThreads >= permanentThreads) {
            return Outcome(
                status = Status.IDLE,
                requestedThreads = requestedThreads,
                appliedThreads = permanentThreads,
                message = "Requested threads not below permanent — no throttle"
            )
        }
        val cmd = Command(requestedThreads, permanentThreads, sessionGeneration, reason)
        if (!engineSupportsHotApply) {
            // Restart-with-override is still a valid apply path when adapter supports relaunch.
            val applied = engineApply(cmd)
            return if (applied != null && applied == requestedThreads) {
                Outcome(Status.APPLIED, requestedThreads, applied, "Throttle applied via relaunch")
            } else if (applied != null) {
                Outcome(
                    Status.FAILED,
                    requestedThreads,
                    applied,
                    "Engine returned threads $applied ≠ requested $requestedThreads",
                    shouldPauseSafely = true
                )
            } else {
                Outcome(
                    Status.UNSUPPORTED,
                    requestedThreads,
                    null,
                    "Engine could not apply soft throttle — pausing safely",
                    shouldPauseSafely = true
                )
            }
        }
        val applied = engineApply(cmd) ?: return Outcome(
            Status.FAILED,
            requestedThreads,
            null,
            "Hot apply failed — pausing safely",
            shouldPauseSafely = true
        )
        return if (applied == requestedThreads) {
            Outcome(Status.APPLIED, requestedThreads, applied, "Throttle applied")
        } else {
            Outcome(
                Status.PENDING,
                requestedThreads,
                null,
                "Awaiting engine readback (pending $requestedThreads)"
            )
        }
    }

    fun restorePermanent(
        permanentThreads: Int?,
        sessionGeneration: Long,
        engineApply: (Command) -> Int?
    ): Outcome {
        val target = permanentThreads ?: return Outcome(
            Status.IDLE, null, null, "No permanent threads to restore"
        )
        val cmd = Command(target, permanentThreads, sessionGeneration, "thermal resume")
        val applied = engineApply(cmd)
        return if (applied == target) {
            Outcome(Status.APPLIED, target, applied, "Restored permanent threads")
        } else {
            Outcome(
                Status.FAILED,
                target,
                applied,
                "Restore failed",
                shouldPauseSafely = true
            )
        }
    }
}
