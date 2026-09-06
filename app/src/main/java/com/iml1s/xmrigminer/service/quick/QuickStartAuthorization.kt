package com.iml1s.xmrigminer.service.quick

import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * One-shot internal start tokens (#123).
 *
 * Exported MainActivity must not treat caller-supplied extras as proof of authority.
 * Only tokens previously [issue]d by this process (Tile / Widget / non-exported receiver)
 * authorize an automatic start; tokens are consumed on first use.
 */
object QuickStartAuthorization {
    private const val DEFAULT_TTL_MS = 60_000L

    private data class Token(
        val expiresAtMs: Long,
        val profileId: String?
    )

    private val tokens = ConcurrentHashMap<String, Token>()

    fun issue(
        nowMs: Long = System.currentTimeMillis(),
        ttlMs: Long = DEFAULT_TTL_MS,
        profileId: String? = null
    ): String {
        prune(nowMs)
        val id = UUID.randomUUID().toString()
        tokens[id] = Token(expiresAtMs = nowMs + ttlMs, profileId = profileId)
        return id
    }

    /**
     * Consume a token. Returns true only once for a valid, unexpired token.
     * Caller-supplied strings that were never issued always fail.
     */
    fun consume(
        token: String?,
        nowMs: Long = System.currentTimeMillis(),
        expectedProfileId: String? = null
    ): Boolean {
        if (token.isNullOrBlank()) return false
        prune(nowMs)
        val held = tokens.remove(token) ?: return false
        if (held.expiresAtMs < nowMs) return false
        if (expectedProfileId != null && held.profileId != null && held.profileId != expectedProfileId) {
            return false
        }
        return true
    }

    fun peekValid(token: String?, nowMs: Long = System.currentTimeMillis()): Boolean {
        if (token.isNullOrBlank()) return false
        val held = tokens[token] ?: return false
        return held.expiresAtMs >= nowMs
    }

    fun resetForTests() {
        tokens.clear()
    }

    private fun prune(nowMs: Long) {
        if (tokens.size <= 64) {
            tokens.entries.removeIf { it.value.expiresAtMs < nowMs }
            return
        }
        tokens.clear()
    }
}
