package com.iml1s.xmrigminer.data.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReconnectPolicyTest {

    @Test
    fun `autoReconnect false does not retry`() {
        var state = ReconnectPolicy.State(autoReconnect = false, maxAttempts = 5)
        state = ReconnectPolicy.beginSession(state, "p1")
        val decision = ReconnectPolicy.onDisconnect(state, code = "timeout", at = 1000L)
        assertEquals(ReconnectPolicy.Phase.FAILED, decision.state.phase)
        assertEquals(ReconnectPolicy.ActionType.STOP, decision.action.type)
        assertTrue(decision.action.reason!!.contains("autoReconnect disabled"))
    }

    @Test
    fun `transient network schedules wait`() {
        var state = ReconnectPolicy.State(autoReconnect = true, maxAttempts = 3, baseMs = 1000L)
        state = ReconnectPolicy.beginSession(state, "p1")
        val decision = ReconnectPolicy.onDisconnect(
            state,
            code = "network",
            message = "No network connection",
            at = 10_000L,
            random = { 0.0 }
        )
        assertEquals(ReconnectPolicy.ActionType.WAIT, decision.action.type)
        assertEquals(ReconnectPolicy.Phase.RECONNECTING, decision.state.phase)
        assertTrue(ReconnectPolicy.uiSnapshot(decision.state).canCancel)
    }

    @Test
    fun `auth fail is fatal`() {
        var state = ReconnectPolicy.State(autoReconnect = true)
        state = ReconnectPolicy.beginSession(state, "p1")
        val decision = ReconnectPolicy.onDisconnect(state, code = "auth_fail", message = "login error")
        assertEquals(ReconnectPolicy.Phase.FAILED, decision.state.phase)
        assertFalse(ReconnectPolicy.workManagerShouldRetry(true, decision.state.lastClassification!!))
    }

    @Test
    fun `thermal pause does not workmanager-retry`() {
        val c = ReconnectPolicy.classify(code = "thermal", message = "Temperature too high")
        assertEquals(ReconnectPolicy.Kind.PAUSE, c.kind)
        assertFalse(ReconnectPolicy.workManagerShouldRetry(true, c))
    }

    @Test
    fun `failover refuses wallet change and tls downgrade`() {
        val primary = ReconnectPolicy.Endpoint(
            id = "p",
            url = "pool:443",
            payoutAsset = "XMR",
            accountUser = "addrA",
            tls = true,
            userApproved = true
        )
        assertFalse(
            ReconnectPolicy.isCompatible(
                primary,
                primary.copy(id = "b", accountUser = "addrB", userApproved = true)
            )
        )
        assertFalse(
            ReconnectPolicy.isCompatible(
                primary,
                primary.copy(id = "b", tls = false, userApproved = true)
            )
        )
        val ok = ReconnectPolicy.selectFailover(
            primary,
            listOf(primary.copy(id = "b1", url = "b:443", userApproved = true)),
            failedId = "p"
        )
        assertEquals("b1", ok!!.id)
    }

    @Test
    fun `user stop cancels reconnect`() {
        var state = ReconnectPolicy.State(autoReconnect = true)
        state = ReconnectPolicy.beginSession(state, "p1")
        state = ReconnectPolicy.onDisconnect(state, code = "dns", at = 1L, random = { 0.5 }).state
        state = ReconnectPolicy.onUserStop(state)
        assertEquals(ReconnectPolicy.Phase.STOPPED, state.phase)
        assertTrue(state.cancelled)
        assertEquals(null, state.nextRetryAt)
    }
}
