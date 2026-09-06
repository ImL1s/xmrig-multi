package com.iml1s.xmrigminer.service.quick

/**
 * Versioned quick-control commands (#79). Whitelist only — no wallet/argv.
 */
data class QuickCommand(
    val commandId: String,
    val type: String,
    val profileId: String? = null,
    val sessionId: String? = null,
    val issuedAtMs: Long,
    val expiresAtMs: Long,
    val pauseForMs: Long? = null,
    val source: String = "in-app"
)

data class QuickAck(
    val ack: String,
    val reason: String,
    val apply: Boolean
)

object QuickCommandProtocol {
    const val SCHEMA_VERSION = 1
    val OPS = setOf(
        "start_profile",
        "stop_mining",
        "pause_for",
        "disable_automation",
        "open_clock"
    )

    fun receive(
        command: QuickCommand,
        nowMs: Long,
        authorized: Boolean,
        userStopLatched: Boolean,
        osStartAllowed: Boolean,
        missingProfile: Boolean,
        sessionId: String?
    ): QuickAck {
        if (command.commandId.isBlank() || command.type !in OPS) {
            return QuickAck("rejected", "Malformed or unknown op", false)
        }
        if (!authorized) {
            return QuickAck("rejected", "Entry not authorized / pairing revoked", false)
        }
        if (command.expiresAtMs < nowMs) {
            return QuickAck("expired", "Command deadline passed", false)
        }
        if (sessionId != null && command.sessionId != null && sessionId != command.sessionId) {
            return QuickAck("rejected", "Session mismatch", false)
        }
        when (command.type) {
            "start_profile" -> {
                if (userStopLatched) {
                    return QuickAck("rejected", "Stop latched — Start ignored", false)
                }
                if (!osStartAllowed) {
                    return QuickAck("rejected", "OS/background start not permitted — open app", false)
                }
                if (missingProfile) {
                    return QuickAck("rejected", "No profile selected", false)
                }
            }
            "pause_for" -> {
                if (userStopLatched) {
                    return QuickAck("rejected", "Stop latched — pause cannot schedule resume", false)
                }
                if ((command.pauseForMs ?: 0L) <= 0L) {
                    return QuickAck("rejected", "pause_for requires positive pauseForMs", false)
                }
            }
        }
        return QuickAck("accepted", "Accepted", true)
    }

    fun mayResumeAfterPause(
        stopRevisionAtPause: Int,
        currentStopRevision: Int,
        resumeAtMs: Long,
        nowMs: Long,
        userStopLatched: Boolean,
        osStartAllowed: Boolean,
        budgetBlocked: Boolean,
        powerBlocked: Boolean
    ): QuickAck {
        if (currentStopRevision > stopRevisionAtPause) {
            return QuickAck("rejected", "Stop latched after pause — resume cancelled", false)
        }
        if (resumeAtMs > nowMs) {
            return QuickAck("queued", "Pause still active", false)
        }
        if (userStopLatched) {
            return QuickAck("rejected", "Stop latched", false)
        }
        if (!osStartAllowed || budgetBlocked || powerBlocked) {
            return QuickAck("rejected", "Safety/budget/OS re-check failed", false)
        }
        return QuickAck("accepted", "Pause elapsed and gates clear", true)
    }

    /** Newer stop_mining wins; duplicate commandId skipped. */
    fun effectiveCommand(commands: List<QuickCommand>): QuickCommand? {
        val seen = mutableSetOf<String>()
        var effective: QuickCommand? = null
        for (cmd in commands.sortedBy { it.issuedAtMs }) {
            if (!seen.add(cmd.commandId)) continue
            val cur = effective
            if (cur == null) {
                effective = cmd
                continue
            }
            if (cmd.type == "stop_mining" && cmd.issuedAtMs >= cur.issuedAtMs) {
                effective = cmd
                continue
            }
            if (cur.type == "stop_mining" && cmd.type == "start_profile" && cmd.issuedAtMs <= cur.issuedAtMs) {
                continue
            }
            if (cmd.issuedAtMs >= cur.issuedAtMs) {
                effective = cmd
            }
        }
        return effective
    }
}
