package com.iml1s.xmrigminer.service.quick

import android.content.Context
import android.content.Intent
import com.iml1s.xmrigminer.presentation.MainActivity
import com.iml1s.xmrigminer.service.MiningSessionLatch
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Single command dispatcher for Tile / Widget / notification (#79).
 * Does not init RandomX here — only latch/state + open UI / enqueue intents.
 */
object QuickCommandHandler {
    private const val TTL_MS = 60_000L
    private val seenIds = ConcurrentHashMap.newKeySet<String>()

    @Volatile
    var pauseUntilMs: Long = 0L
        private set

    @Volatile
    var stopRevisionAtPause: Int = 0
        private set

    @Volatile
    var automationArmed: Boolean = true
        private set

    @Volatile
    var lastAck: QuickAck = QuickAck("completed", "idle", false)
        private set

    fun snapshot(mining: Boolean, profileId: String?, waitingReason: String?): QuickSnapshot {
        return QuickSnapshot(
            mining = mining,
            automationArmed = automationArmed,
            waitingReason = waitingReason,
            profileId = profileId,
            userStopLatched = MiningSessionLatch.isUserStopped(),
            pauseUntilMs = pauseUntilMs.takeIf { it > System.currentTimeMillis() },
            updatedAtMs = System.currentTimeMillis()
        )
    }

    fun handle(
        context: Context,
        type: String,
        profileId: String? = null,
        pauseForMs: Long? = null,
        source: String = "in-app",
        authorized: Boolean = true,
        osStartAllowed: Boolean = true,
        missingProfile: Boolean = false,
        sessionId: String? = null
    ): QuickAck {
        val now = System.currentTimeMillis()
        val cmd = QuickCommand(
            commandId = UUID.randomUUID().toString(),
            type = type,
            profileId = profileId,
            sessionId = sessionId,
            issuedAtMs = now,
            expiresAtMs = now + TTL_MS,
            pauseForMs = pauseForMs,
            source = source
        )
        if (!seenIds.add(cmd.commandId)) {
            return QuickAck("completed", "duplicate commandId", false).also { lastAck = it }
        }
        // Bound memory
        if (seenIds.size > 256) seenIds.clear()

        val decision = QuickCommandProtocol.receive(
            command = cmd,
            nowMs = now,
            authorized = authorized,
            userStopLatched = MiningSessionLatch.isUserStopped(),
            osStartAllowed = osStartAllowed,
            missingProfile = missingProfile,
            sessionId = sessionId
        )
        if (!decision.apply) {
            lastAck = decision
            return decision
        }

        when (cmd.type) {
            "stop_mining" -> {
                MiningSessionLatch.latchUserStop()
                pauseUntilMs = 0L
                // Production: MiningController.stop() via WorkManager cancel — not RandomX here.
                lastAck = QuickAck("accepted", "Stop latched", true)
            }
            "disable_automation" -> {
                automationArmed = false
                lastAck = QuickAck("accepted", "Automation disabled (mining stop separate)", true)
            }
            "pause_for" -> {
                stopRevisionAtPause = MiningSessionLatch.userStopRevision
                pauseUntilMs = now + (cmd.pauseForMs ?: 0L)
                lastAck = QuickAck("accepted", "Paused until $pauseUntilMs", true)
            }
            "start_profile" -> {
                if (MiningSessionLatch.isUserStopped()) {
                    lastAck = QuickAck("rejected", "Stop latched — Start ignored", false)
                    return lastAck
                }
                if (!automationArmed) {
                    lastAck = QuickAck("rejected", "Automation disabled — enable in app", false)
                    return lastAck
                }
                MiningSessionLatch.armSession()
                // Open app to complete authorized start (FGS rules).
                openApp(context, "start")
                lastAck = QuickAck("queued", "Start queued — complete in app if required", true)
            }
            "open_clock" -> {
                openApp(context, "clock")
                lastAck = QuickAck("accepted", "Opening clock", true)
            }
            else -> lastAck = QuickAck("rejected", "Unknown", false)
        }
        return lastAck
    }

    fun evaluatePauseResume(
        nowMs: Long = System.currentTimeMillis(),
        osStartAllowed: Boolean = true,
        budgetBlocked: Boolean = false,
        powerBlocked: Boolean = false
    ): QuickAck {
        return QuickCommandProtocol.mayResumeAfterPause(
            stopRevisionAtPause = stopRevisionAtPause,
            currentStopRevision = MiningSessionLatch.userStopRevision,
            resumeAtMs = pauseUntilMs,
            nowMs = nowMs,
            userStopLatched = MiningSessionLatch.isUserStopped(),
            osStartAllowed = osStartAllowed,
            budgetBlocked = budgetBlocked,
            powerBlocked = powerBlocked
        )
    }

    private fun openApp(context: Context, action: String) {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
            putExtra("quick_action", action)
        }
        context.startActivity(intent)
    }
}

data class QuickSnapshot(
    val mining: Boolean,
    val automationArmed: Boolean,
    val waitingReason: String?,
    val profileId: String?,
    val userStopLatched: Boolean,
    val pauseUntilMs: Long?,
    val updatedAtMs: Long
)
