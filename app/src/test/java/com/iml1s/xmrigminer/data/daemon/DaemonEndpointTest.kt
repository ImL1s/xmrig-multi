package com.iml1s.xmrigminer.data.daemon

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DaemonEndpointTest {

    @Test
    fun `http scheme is not parsed as host`() {
        val p = DaemonEndpoint.parse("http://monerod.local:18081")
        assertTrue(p.ok)
        assertEquals("monerod.local", p.host)
        assertEquals(18081, p.port)
        assertEquals("monerod.local:18081", p.engineUrl)
    }

    @Test
    fun `illegal port does not fall back to 18081`() {
        val p = DaemonEndpoint.parse("node.example:99999")
        assertFalse(p.ok)
        assertEquals("bad_port", p.code)
    }

    @Test
    fun `ipv6 brackets`() {
        val p = DaemonEndpoint.parse("[2001:db8::1]:18081")
        assertTrue(p.ok)
        assertEquals("[2001:db8::1]:18081", p.engineUrl)
    }

    @Test
    fun `tcp alone is not mining ready`() {
        val r = DaemonEndpoint.preflightAfterTcp(
            raw = "127.0.0.1:18081",
            tcpOk = true,
            rpcProbed = false
        )
        assertFalse(r.ok)
        assertEquals("rpc_required", r.code)
        assertTrue(r.tcpOnly)
    }

    @Test
    fun `syncing daemon fails preflight`() {
        val r = DaemonEndpoint.preflightAfterTcp(
            raw = "10.0.0.2:18081",
            tcpOk = true,
            rpcProbed = true,
            rpcSynchronized = false
        )
        assertEquals("syncing", r.code)
    }

    @Test
    fun `ready when synchronized`() {
        val r = DaemonEndpoint.preflightAfterTcp(
            raw = "http://10.0.0.2:18081",
            tcpOk = true,
            rpcProbed = true,
            rpcSynchronized = true,
            rpcNettype = "mainnet"
        )
        assertTrue(r.ok)
        assertEquals("10.0.0.2:18081", r.parsed?.engineUrl)
    }
}
