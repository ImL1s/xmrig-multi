package com.iml1s.xmrigminer.data.ambient

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AmbientClockPolicyTest {

    @Test
    fun `pure clock does not start miner or require wallet`() {
        val r = AmbientClockPolicy.resolve(AmbientMode.CLOCK_ONLY)
        val fx = AmbientClockPolicy.sideEffects(r)
        assertFalse(fx.startMiner)
        assertFalse(fx.connectPool)
        assertFalse(fx.loadRandomX)
        assertFalse(r.requiresWallet)
    }

    @Test
    fun `minute tick aligns`() {
        val now = 1_725_000_000_000L + 30_000L
        assertEquals(30_000L, AmbientClockPolicy.nextTickMs(now, showSeconds = false))
    }

    @Test
    fun `night dim applies after 22h`() {
        assertEquals(0.35f, AmbientClockPolicy.nightDimFactor(23 * 60), 1e-6f)
        assertEquals(1f, AmbientClockPolicy.nightDimFactor(12 * 60), 1e-6f)
    }

    @Test
    fun `elapsed ignores backwards mono`() {
        assertNull(AmbientClockPolicy.sessionElapsedMs(5000, 1000))
        assertEquals(4000L, AmbientClockPolicy.sessionElapsedMs(1000, 5000))
    }

    @Test
    fun `redact hides middle of address`() {
        val a = "8AfUwcnoJiRDMXnDGj3zX6bMgfaj9pM1WFGr2pakLm3j"
        val r = AmbientClockPolicy.redactAddress(a)!!
        assertTrue(r.contains("…"))
        assertFalse(r.contains(a.substring(10, 20)))
    }
}
