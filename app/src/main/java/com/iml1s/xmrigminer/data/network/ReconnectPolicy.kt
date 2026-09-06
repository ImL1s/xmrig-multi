package com.iml1s.xmrigminer.data.network

import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToLong
import kotlin.random.Random

/**
 * Reconnect decision helpers (#43). Mirrors shared/reconnect-policy.
 */
object ReconnectPolicy {

    enum class FailureClass { RETRYABLE, FATAL, POLICY_STOP, USER_STOP }
    enum class Action { RETRY, STOP, EXHAUSTED }

    data class Decision(
        val action: Action,
        val reason: String,
        val attempt: Int,
        val delayMs: Long?,
        val failureClass: FailureClass?
    )

    fun nativeRetries(autoReconnect: Boolean, configured: Int = 5): Int =
        if (!autoReconnect) 0 else configured.coerceAtLeast(0)

    fun classify(code: String? = null, message: String? = null, kind: String? = null): FailureClass {
        val c = (code ?: "").lowercase()
        val m = (message ?: "").lowercase()
        val k = (kind ?: "").lowercase()
        if (k == "user_stop" || c == "user_stop") return FailureClass.USER_STOP
        if (k in setOf("policy_stop", "thermal_critical", "profile_change")) return FailureClass.POLICY_STOP
        if (
            Regex("auth|login|invalid.?user|bad.?wallet|unauth|forbidden|unsupported").containsMatchIn(m) ||
            c in setOf("auth_fail", "bad_wallet", "unsupported_protocol", "tls_cert") ||
            Regex("cert|certificate|tls|ssl").containsMatchIn(m)
        ) {
            return FailureClass.FATAL
        }
        if (
            Regex("timeout|econnreset|econnrefused|enotfound|dns|network|disconnect|close").containsMatchIn(m) ||
            c in setOf("timeout", "dns", "econnreset", "econnrefused", "enotfound", "network_change", "ws_close") ||
            k in setOf("disconnect", "network_change", "close")
        ) {
            return FailureClass.RETRYABLE
        }
        return FailureClass.FATAL
    }

    fun decide(
        autoReconnect: Boolean,
        attempt: Int = 0,
        maxAttempts: Int = 5,
        code: String? = null,
        message: String? = null,
        kind: String? = null,
        userStopped: Boolean = false,
        thermalCritical: Boolean = false,
        profileChanged: Boolean = false,
        baseMs: Long = 1000,
        maxMs: Long = 60_000,
        random: Random = Random.Default
    ): Decision {
        if (!autoReconnect) {
            return Decision(Action.STOP, "autoReconnect disabled", attempt, null, null)
        }
        if (userStopped) return Decision(Action.STOP, "user stopped", attempt, null, FailureClass.USER_STOP)
        if (thermalCritical) {
            return Decision(Action.STOP, "thermal critical", attempt, null, FailureClass.POLICY_STOP)
        }
        if (profileChanged) {
            return Decision(Action.STOP, "profile changed", attempt, null, FailureClass.POLICY_STOP)
        }
        val fc = classify(code, message, kind)
        if (fc != FailureClass.RETRYABLE) {
            return Decision(Action.STOP, fc.name.lowercase(), attempt, null, fc)
        }
        if (attempt >= maxAttempts) {
            return Decision(Action.EXHAUSTED, "retry budget exhausted", attempt, null, fc)
        }
        val exp = min(maxMs.toDouble(), baseMs * 2.0.pow(attempt.toDouble()))
        val jitter = exp * 0.2 * (random.nextDouble() * 2 - 1)
        val delay = (exp + jitter).roundToLong().coerceAtLeast(0)
        return Decision(Action.RETRY, "transient", attempt, delay, fc)
    }
}
