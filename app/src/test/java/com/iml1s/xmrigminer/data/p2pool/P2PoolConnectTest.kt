package com.iml1s.xmrigminer.data.p2pool

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class P2PoolConnectTest {
    @Test
    fun `stratum parse rejects rpc looking urls and public hosts`() {
        assertEquals("looks_like_rpc", P2PoolConnect.parseStratum("http://127.0.0.1:18081/json_rpc").code)
        assertEquals("untrusted_host", P2PoolConnect.parseStratum("8.8.8.8:3333").code)
    }

    @Test
    fun `lan stratum defaults to port 3333 and daemon false`() {
        val parsed = P2PoolConnect.parseStratum("192.168.0.5")
        assertTrue(parsed.ok)
        assertEquals(3333, parsed.endpoint!!.port)
        val fields = P2PoolConnect.stratumPoolFields(parsed.endpoint!!, "4" + "A".repeat(94))
        assertEquals(false, fields["daemon"])
        assertFalse(fields["daemon"] as Boolean)
    }

    @Test
    fun `fee disclaimer is present`() {
        assertTrue(P2PoolConnect.feeDisclaimer().contains("Not a payment guarantee"))
    }
}
