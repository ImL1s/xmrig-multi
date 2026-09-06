package com.iml1s.xmrigminer.native

import java.security.SecureRandom
import java.util.UUID

/**
 * Per-mining-session loopback HTTP API binding (#134).
 * Never binds 0.0.0.0; remote control stays off by default.
 */
data class XmrigHttpApiSession(
    val host: String = "127.0.0.1",
    val port: Int,
    val accessToken: String,
    val instanceId: String,
    /** When false, XMRig restricts write endpoints. Thermal hot-apply needs true + token. */
    val allowWrites: Boolean = true
) {
    companion object {
        private val random = SecureRandom()

        fun create(allowWrites: Boolean = true): XmrigHttpApiSession {
            // Ephemeral high port; collision retried by caller if bind fails.
            val port = 40_000 + random.nextInt(20_000)
            val tokenBytes = ByteArray(24)
            random.nextBytes(tokenBytes)
            val token = tokenBytes.joinToString("") { "%02x".format(it) }
            return XmrigHttpApiSession(
                port = port,
                accessToken = token,
                instanceId = UUID.randomUUID().toString(),
                allowWrites = allowWrites
            )
        }
    }
}
