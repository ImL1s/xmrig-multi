package com.iml1s.xmrigminer.data.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class ReconnectPolicyTest {

    @Test
    fun `autoReconnect false forces zero native retries and stop`() {
        assertEquals(0, ReconnectPolicy.nativeRetries(false, 5))
        val d = ReconnectPolicy.decide(
            autoReconnect = false,
            code = "timeout",
            message = "timed out",
            random = Random(1)
        )
        assertEquals(ReconnectPolicy.Action.STOP, d.action)
    }

    @Test
    fun `auth failure is fatal`() {
        val d = ReconnectPolicy.decide(
            autoReconnect = true,
            code = "auth_fail",
            message = "login error",
            random = Random(1)
        )
        assertEquals(ReconnectPolicy.Action.STOP, d.action)
        assertEquals(ReconnectPolicy.FailureClass.FATAL, d.failureClass)
    }

    @Test
    fun `transient timeout schedules retry within budget`() {
        val d = ReconnectPolicy.decide(
            autoReconnect = true,
            attempt = 0,
            maxAttempts = 5,
            code = "timeout",
            message = "timed out",
            random = Random(0)
        )
        assertEquals(ReconnectPolicy.Action.RETRY, d.action)
        assertTrue(d.delayMs != null && d.delayMs!! >= 0)
    }

    @Test
    fun `exhausted after max attempts`() {
        val d = ReconnectPolicy.decide(
            autoReconnect = true,
            attempt = 5,
            maxAttempts = 5,
            code = "econnreset",
            message = "reset",
            random = Random(1)
        )
        assertEquals(ReconnectPolicy.Action.EXHAUSTED, d.action)
    }
}
