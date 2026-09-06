package com.iml1s.xmrigminer.wear

/**
 * Phone-side companion command policy (#62). Mirrors shared/companion-sync rules.
 */
object CompanionCommandPolicy {

    const val DEFAULT_TTL_MS = 60_000L
    const val DEFAULT_STALE_AFTER_MS = 45_000L

    enum class Ack { ACCEPTED, REJECTED, COMPLETED, EXPIRED, UNDELIVERED, PENDING }

    enum class SyncQuality { LIVE, STALE, OFFLINE }

    data class Command(
        val commandId: String,
        val type: String,
        val targetDeviceId: String,
        val profileId: String? = null,
        val sessionId: String? = null,
        val issuedAtMs: Long,
        val expiresAtMs: Long
    )

    data class ReceiveResult(val ack: Ack, val reason: String, val apply: Boolean)

    data class SyncState(
        val quality: SyncQuality,
        val label: String,
        val showAsLive: Boolean
    )

    fun classifySync(
        paired: Boolean,
        reachable: Boolean,
        lastSyncAtMs: Long?,
        nowMs: Long,
        staleAfterMs: Long = DEFAULT_STALE_AFTER_MS
    ): SyncState {
        if (!paired || !reachable || lastSyncAtMs == null) {
            return SyncState(SyncQuality.OFFLINE, "Offline — last numbers are not live", false)
        }
        val age = nowMs - lastSyncAtMs
        if (age > staleAfterMs) {
            return SyncState(SyncQuality.STALE, "Stale (${age / 1000}s ago)", false)
        }
        return SyncState(SyncQuality.LIVE, "Live", true)
    }

    fun receive(
        command: Command,
        nowMs: Long,
        paired: Boolean,
        authenticated: Boolean,
        reachable: Boolean,
        phoneSessionId: String?,
        thermalBlocked: Boolean = false,
        powerBlocked: Boolean = false,
        missingConfig: Boolean = false,
        userStopLatched: Boolean = false
    ): ReceiveResult {
        if (!paired) return ReceiveResult(Ack.REJECTED, "Not paired / unauthorized", false)
        if (!authenticated) return ReceiveResult(Ack.REJECTED, "Channel not authenticated", false)
        if (command.expiresAtMs < nowMs) {
            return ReceiveResult(Ack.EXPIRED, "Command expired before delivery", false)
        }
        if (!reachable) {
            return ReceiveResult(Ack.UNDELIVERED, "Phone unreachable — stop not guaranteed", false)
        }
        if (phoneSessionId != null && command.sessionId != null && phoneSessionId != command.sessionId) {
            return ReceiveResult(Ack.REJECTED, "Session mismatch (phone restarted or new session)", false)
        }
        if (command.type == "start") {
            if (thermalBlocked) return ReceiveResult(Ack.REJECTED, "Thermal policy blocked start", false)
            if (powerBlocked) return ReceiveResult(Ack.REJECTED, "Power policy blocked start", false)
            if (missingConfig) return ReceiveResult(Ack.REJECTED, "No saved mining profile on phone", false)
            if (userStopLatched) {
                return ReceiveResult(Ack.REJECTED, "Manual Stop latched — remote Start ignored", false)
            }
        }
        return ReceiveResult(Ack.ACCEPTED, "Accepted", true)
    }

    /**
     * Newer Stop wins; duplicate commandId is idempotent.
     */
    fun effectiveCommand(commands: List<Command>): Command? {
        val seen = mutableSetOf<String>()
        var effective: Command? = null
        for (cmd in commands.sortedBy { it.issuedAtMs }) {
            if (!seen.add(cmd.commandId)) continue
            val cur = effective
            if (cur == null) {
                effective = cmd
                continue
            }
            if (cmd.type == "stop" && cmd.issuedAtMs >= cur.issuedAtMs) {
                effective = cmd
                continue
            }
            if (cur.type == "stop" && cmd.type == "start" && cmd.issuedAtMs <= cur.issuedAtMs) {
                continue
            }
            if (cmd.issuedAtMs >= cur.issuedAtMs) effective = cmd
        }
        return effective
    }

    fun containsSecretKey(key: String): Boolean {
        val k = key.lowercase()
        return k.contains("wallet") || k.contains("password") || k.contains("token") ||
            k.contains("secret") || k.contains("seed") || k == "pass"
    }
}
