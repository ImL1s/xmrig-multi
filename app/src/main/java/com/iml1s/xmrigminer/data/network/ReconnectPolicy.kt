package com.iml1s.xmrigminer.data.network

/**
 * Android port of shared/reconnect (#43).
 * WorkManager / MonitorWorker / UI must consult this owner instead of unbounded Result.retry().
 */
object ReconnectPolicy {

    enum class Phase { IDLE, MINING, RECONNECTING, FAILOVER, PAUSED, STOPPED, FAILED }
    enum class Kind { RETRYABLE, FATAL, PAUSE }
    enum class ActionType { NONE, WAIT, STOP, PAUSE, FAILOVER, RECONNECT }

    data class Classification(
        val kind: Kind,
        val code: String,
        val retryable: Boolean,
        val label: String
    )

    data class Endpoint(
        val id: String,
        val url: String,
        val payoutAsset: String? = null,
        val accountUser: String? = null,
        val tls: Boolean = false,
        val protocol: String = "stratum",
        val enabled: Boolean = true,
        val userApproved: Boolean = false,
        val allowTlsDowngrade: Boolean = false
    )

    data class State(
        val phase: Phase = Phase.IDLE,
        val autoReconnect: Boolean = true,
        val maxAttempts: Int = 5,
        val baseMs: Long = 5_000L,
        val maxMs: Long = 60_000L,
        val attempt: Int = 0,
        val reason: String? = null,
        val nextRetryAt: Long? = null,
        val activeEndpointId: String? = null,
        val primaryEndpointId: String? = null,
        val lastClassification: Classification? = null,
        val profileRevision: Int = 0,
        val cancelled: Boolean = false,
        val generation: Int = 0
    )

    data class Action(
        val type: ActionType,
        val delayMs: Long = 0,
        val nextRetryAt: Long? = null,
        val reason: String? = null,
        val endpointId: String? = null,
        val endpoint: Endpoint? = null
    )

    data class Decision(val state: State, val action: Action)

    data class UiSnapshot(
        val phase: Phase,
        val reason: String?,
        val nextRetryAt: Long?,
        val attempt: Int,
        val maxAttempts: Int,
        val autoReconnect: Boolean,
        val canCancel: Boolean,
        val activeEndpointId: String?
    )

    fun uiSnapshot(state: State) = UiSnapshot(
        phase = state.phase,
        reason = state.reason,
        nextRetryAt = state.nextRetryAt,
        attempt = state.attempt,
        maxAttempts = state.maxAttempts,
        autoReconnect = state.autoReconnect,
        canCancel = state.phase == Phase.RECONNECTING || state.phase == Phase.FAILOVER,
        activeEndpointId = state.activeEndpointId
    )

    fun beginSession(state: State, endpointId: String, profileRevision: Int = state.profileRevision): State =
        state.copy(
            phase = Phase.MINING,
            attempt = 0,
            reason = null,
            nextRetryAt = null,
            cancelled = false,
            activeEndpointId = endpointId,
            primaryEndpointId = endpointId,
            profileRevision = profileRevision,
            generation = state.generation + 1,
            lastClassification = null
        )

    fun classify(code: String? = null, message: String? = null): Classification {
        val raw = listOfNotNull(code, message).joinToString(" ").lowercase()
        val c = (code ?: inferCode(raw) ?: "unknown").lowercase()
        return when {
            c in setOf("user_stop", "profile_change", "cancelled") ||
                raw.contains("manual stop") || raw.contains("profile change") ->
                Classification(Kind.FATAL, c, false, "stopped by user or policy")
            c in setOf("auth_fail", "bad_wallet", "unsupported_protocol", "login_fail") ||
                raw.contains("login error") || raw.contains("unauthorized") ->
                Classification(Kind.FATAL, c, false, "credentials or protocol rejected")
            c == "tls_cert" || raw.contains("certificate") || raw.contains("ssl handshake") ->
                Classification(Kind.FATAL, c, false, "TLS certificate rejected")
            c in setOf("thermal", "battery", "policy_pause") ||
                raw.contains("thermal") || raw.contains("battery too low") ->
                Classification(Kind.PAUSE, c, false, "policy pause — no auto restart")
            c in setOf("timeout", "dns", "network", "conn_refused", "proxy_close") ||
                raw.contains("network") || raw.contains("timeout") || raw.contains("disconnect") ->
                Classification(Kind.RETRYABLE, if (c == "unknown") "network" else c, true, "transient disconnect")
            else -> Classification(Kind.FATAL, c, false, "non-retryable failure")
        }
    }

    fun nextBackoff(attempt: Int, baseMs: Long, maxMs: Long, random: () -> Double = { 0.5 }): Long {
        val raw = baseMs * Math.pow(2.0, attempt.coerceAtLeast(0).toDouble())
        val base = raw.coerceAtMost(maxMs.toDouble())
        val jitterRatio = 0.2
        val jitter = base * jitterRatio * random()
        return (base - (base * jitterRatio) / 2 + jitter).toLong().coerceIn(0L, maxMs)
    }

    fun onDisconnect(
        state: State,
        code: String? = null,
        message: String? = null,
        at: Long = System.currentTimeMillis(),
        primary: Endpoint? = null,
        backups: List<Endpoint> = emptyList(),
        random: () -> Double = { 0.5 }
    ): Decision {
        if (state.cancelled || state.phase == Phase.STOPPED) {
            return Decision(
                state.copy(phase = Phase.STOPPED, nextRetryAt = null),
                Action(ActionType.NONE)
            )
        }
        val classification = classify(code, message)
        var next = state.copy(lastClassification = classification, reason = classification.label)

        if (classification.kind == Kind.PAUSE) {
            next = next.copy(phase = Phase.PAUSED, nextRetryAt = null, attempt = 0)
            return Decision(next, Action(ActionType.PAUSE, reason = classification.label))
        }

        if (classification.kind == Kind.FATAL || !next.autoReconnect) {
            next = next.copy(
                phase = if (classification.code == "user_stop") Phase.STOPPED else Phase.FAILED,
                nextRetryAt = null
            )
            return Decision(
                next,
                Action(
                    ActionType.STOP,
                    reason = if (next.autoReconnect) classification.label else "autoReconnect disabled"
                )
            )
        }

        if (next.attempt >= next.maxAttempts) {
            val fo = tryFailover(next, primary, backups, at)
            if (fo != null) return fo
            next = next.copy(phase = Phase.FAILED, nextRetryAt = null, reason = "reconnect attempts exhausted")
            return Decision(next, Action(ActionType.STOP, reason = next.reason))
        }

        val delay = nextBackoff(next.attempt, next.baseMs, next.maxMs, random)
        next = next.copy(
            phase = Phase.RECONNECTING,
            attempt = next.attempt + 1,
            nextRetryAt = at + delay
        )
        return Decision(
            next,
            Action(
                type = ActionType.WAIT,
                delayMs = delay,
                nextRetryAt = next.nextRetryAt,
                reason = classification.label,
                endpointId = next.activeEndpointId
            )
        )
    }

    private fun tryFailover(
        state: State,
        primary: Endpoint?,
        backups: List<Endpoint>,
        at: Long
    ): Decision? {
        if (primary == null) return null
        val pick = selectFailover(primary, backups, state.activeEndpointId) ?: return null
        val next = state.copy(
            phase = Phase.FAILOVER,
            attempt = 0,
            activeEndpointId = pick.id,
            reason = "failover → ${pick.id}",
            nextRetryAt = at
        )
        return Decision(next, Action(ActionType.FAILOVER, endpoint = pick, reason = "compatible", endpointId = pick.id))
    }

    fun selectFailover(primary: Endpoint, backups: List<Endpoint>, failedId: String?): Endpoint? {
        val candidates = backups + primary
        for (ep in candidates) {
            if (failedId != null && ep.id == failedId) continue
            if (!ep.enabled) continue
            if (ep.id != primary.id && !ep.userApproved) continue
            if (!isCompatible(primary, ep)) continue
            return ep
        }
        return null
    }

    fun isCompatible(primary: Endpoint, candidate: Endpoint): Boolean {
        if (primary.payoutAsset != null && candidate.payoutAsset != null &&
            primary.payoutAsset != candidate.payoutAsset
        ) return false
        if (primary.accountUser != null && candidate.accountUser != null &&
            primary.accountUser != candidate.accountUser
        ) return false
        if ((primary.protocol) != (candidate.protocol)) return false
        val cTls = candidate.tls
        if (primary.tls && !cTls && !candidate.allowTlsDowngrade) return false
        return true
    }

    fun onUserStop(state: State): State = state.copy(
        phase = Phase.STOPPED,
        cancelled = true,
        nextRetryAt = null,
        reason = "manual stop",
        attempt = 0,
        generation = state.generation + 1
    )

    fun onPolicyPause(state: State, reason: String): State = state.copy(
        phase = Phase.PAUSED,
        cancelled = true,
        nextRetryAt = null,
        reason = reason
    )

    fun onProfileChange(state: State, revision: Int): State = state.copy(
        phase = Phase.STOPPED,
        cancelled = true,
        nextRetryAt = null,
        reason = "profile change",
        profileRevision = revision,
        generation = state.generation + 1
    )

    fun workManagerShouldRetry(autoReconnect: Boolean, classification: Classification): Boolean =
        autoReconnect && classification.retryable

    private fun inferCode(raw: String): String? = when {
        raw.contains("auth") || raw.contains("login") -> "auth_fail"
        raw.contains("wallet") -> "bad_wallet"
        raw.contains("tls") || raw.contains("certificate") -> "tls_cert"
        raw.contains("dns") -> "dns"
        raw.contains("timeout") -> "timeout"
        raw.contains("thermal") -> "thermal"
        raw.contains("battery") -> "battery"
        raw.contains("network") || raw.contains("unreachable") -> "network"
        else -> null
    }
}
