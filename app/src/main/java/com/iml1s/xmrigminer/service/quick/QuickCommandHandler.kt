package com.iml1s.xmrigminer.service.quick

import android.content.Context
import android.content.Intent
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.iml1s.xmrigminer.native.XmrigProcessController
import com.iml1s.xmrigminer.presentation.MainActivity
import com.iml1s.xmrigminer.service.MiningSessionLatch
import com.iml1s.xmrigminer.service.MiningWorker
import com.iml1s.xmrigminer.service.MonitorWorker
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Single command dispatcher for Tile / Widget / notification (#79 / #123 / #124).
 * Does not init RandomX here — stop via WorkManager cancel + process sweep.
 * Automation defaults off (persisted on [MiningSessionLatch]); start opens the app with a
 * one-shot auth token — never trusts caller-supplied authorized extras alone.
 */
object QuickCommandHandler {
    private const val TTL_MS = 60_000L
    private val seenIds: MutableSet<String> =
        java.util.Collections.newSetFromMap(ConcurrentHashMap())

    @Volatile
    var lastAck: QuickAck = QuickAck("completed", "idle", false)
        private set

    /** Delegates to session owner so Tile/Widget share one snapshot (#124). */
    val pauseUntilMs: Long
        get() = MiningSessionLatch.policyPauseUntilMs()

    val stopRevisionAtPause: Int
        get() = MiningSessionLatch.stopRevisionAtPause

    val automationArmed: Boolean
        get() = MiningSessionLatch.isAutomationArmed()

    fun isMiningActive(context: Context): Boolean {
        return try {
            val infos = WorkManager.getInstance(context)
                .getWorkInfosForUniqueWork(MiningWorker.WORK_NAME)
                .get()
            infos.any {
                it.state == WorkInfo.State.RUNNING || it.state == WorkInfo.State.ENQUEUED
            }
        } catch (_: Exception) {
            false
        }
    }

    fun snapshot(context: Context, profileId: String?, waitingReason: String?): QuickSnapshot {
        val snap = MiningSessionLatch.snapshot()
        return QuickSnapshot(
            mining = isMiningActive(context),
            automationArmed = snap.automationArmed,
            waitingReason = waitingReason,
            profileId = profileId,
            userStopLatched = snap.userStopLatched,
            pauseUntilMs = snap.policyPauseUntilMs,
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
        sessionId: String? = null,
        commandId: String? = null
    ): QuickAck {
        val now = System.currentTimeMillis()
        val id = commandId?.takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString()
        if (!seenIds.add(id)) {
            return QuickAck("completed", "duplicate commandId", false).also { lastAck = it }
        }
        if (seenIds.size > 256) seenIds.clear()

        val cmd = QuickCommand(
            commandId = id,
            type = type,
            profileId = profileId,
            sessionId = sessionId,
            issuedAtMs = now,
            expiresAtMs = now + TTL_MS,
            pauseForMs = pauseForMs,
            source = source
        )

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
                stopMiningProcesses(context)
                lastAck = QuickAck("accepted", "Stop latched and mining cancelled", true)
            }
            "disable_automation" -> {
                MiningSessionLatch.setAutomationArmed(false)
                lastAck = QuickAck("accepted", "Automation disabled (mining stop separate)", true)
            }
            "enable_automation" -> {
                MiningSessionLatch.setAutomationArmed(true)
                lastAck = QuickAck("accepted", "Automation enabled", true)
            }
            "pause_for" -> {
                val until = now + (cmd.pauseForMs ?: 0L)
                MiningSessionLatch.latchPolicyPause(until)
                stopMiningProcesses(context)
                lastAck = QuickAck("accepted", "Paused until $until", true)
            }
            "start_profile" -> {
                if (MiningSessionLatch.isUserStopped()) {
                    lastAck = QuickAck("rejected", "Stop latched — Start ignored", false)
                    return lastAck
                }
                if (!MiningSessionLatch.isAutomationArmed()) {
                    lastAck = QuickAck("rejected", "Automation disabled — enable in app", false)
                    return lastAck
                }
                if (MiningSessionLatch.isPolicyPaused(now)) {
                    lastAck = QuickAck("rejected", "Still in pause window", false)
                    return lastAck
                }
                // Do NOT arm here — MiningController.start arms only after validation (#124).
                openAppAuthorizedStart(context, profileId)
                lastAck = QuickAck("queued", "Open app to complete authorized start", true)
            }
            "open_clock" -> {
                openApp(context, "clock", authToken = null)
                lastAck = QuickAck("accepted", "Opening app", true)
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
            stopRevisionAtPause = MiningSessionLatch.stopRevisionAtPause,
            currentStopRevision = MiningSessionLatch.userStopRevision,
            resumeAtMs = MiningSessionLatch.policyPauseUntilMs(),
            nowMs = nowMs,
            userStopLatched = MiningSessionLatch.isUserStopped(),
            osStartAllowed = osStartAllowed,
            budgetBlocked = budgetBlocked,
            powerBlocked = powerBlocked
        )
    }

    /** Same stop path as UI without RandomX init in the caller. */
    fun stopMiningProcesses(context: Context) {
        val wm = WorkManager.getInstance(context.applicationContext)
        wm.cancelUniqueWork(MiningWorker.WORK_NAME)
        wm.cancelUniqueWork(MonitorWorker.WORK_NAME)
        XmrigProcessController.killLeftoverMiners()
    }

    private fun openAppAuthorizedStart(context: Context, profileId: String?) {
        val token = QuickStartAuthorization.issue(profileId = profileId)
        openApp(context, "start", authToken = token)
    }

    private fun openApp(context: Context, action: String, authToken: String?) {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(MainActivity.EXTRA_QUICK_ACTION, action)
            if (authToken != null) {
                putExtra(MainActivity.EXTRA_QUICK_AUTH_TOKEN, authToken)
            }
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
