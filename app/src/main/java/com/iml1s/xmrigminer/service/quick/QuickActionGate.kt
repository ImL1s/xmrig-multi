package com.iml1s.xmrigminer.service.quick

/**
 * Pure gate for exported MainActivity quick_action=start (#123).
 * Separates navigation/confirm from auto-start so external intents cannot mine silently.
 */
object QuickActionGate {
    enum class StartDisposition {
        /** Valid one-shot token + automation → auto-start via controller. */
        AUTHORIZED_AUTO_START,
        /** Stop latched — toast only. */
        BLOCKED_USER_STOP,
        /** Token ok but automation off. */
        BLOCKED_AUTOMATION_OFF,
        /** No/invalid token — show user confirmation dialog; never silent start. */
        REQUIRE_USER_CONFIRM,
        /** Missing action / ignore. */
        IGNORE
    }

    fun decideStart(
        action: String?,
        authToken: String?,
        userStopped: Boolean,
        automationArmed: Boolean,
        nowMs: Long = System.currentTimeMillis(),
        consumeToken: (String?, Long) -> Boolean = { token, t ->
            QuickStartAuthorization.consume(token, nowMs = t)
        }
    ): StartDisposition {
        if (action != "start") return StartDisposition.IGNORE
        if (userStopped) return StartDisposition.BLOCKED_USER_STOP
        val authorized = consumeToken(authToken, nowMs)
        if (!authorized) return StartDisposition.REQUIRE_USER_CONFIRM
        if (!automationArmed) return StartDisposition.BLOCKED_AUTOMATION_OFF
        return StartDisposition.AUTHORIZED_AUTO_START
    }
}
