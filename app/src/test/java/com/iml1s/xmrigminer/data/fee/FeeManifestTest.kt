package com.iml1s.xmrigminer.data.fee

import com.iml1s.xmrigminer.service.DevFeePolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FeeManifestTest {

    @Test
    fun `android summary never shows unknown pool as 0 percent`() {
        val s = FeeManifest.androidSummary(poolFeePercent = null)
        assertFalse(s.mismatch)
        val pool = s.layers.find { it.kind == "pool" }!!
        assertEquals("unknown (not 0%)", pool.rateLabel)
        assertTrue(s.lines.none { it.contains("pool: 0%") })
        assertEquals(DevFeePolicy.WALLET, s.developerWallet)
    }

    @Test
    fun `ios tracked binary flagged mismatch`() {
        assertTrue(FeeManifest.iosTrackedBinaryMismatch())
        val s = FeeManifest.iosSummary()
        assertTrue(s.mismatch)
        assertTrue(s.lines.any { it.contains("upstream") })
    }

    @Test
    fun `developer rate matches DevFeePolicy`() {
        val s = FeeManifest.androidSummary()
        assertTrue(s.layers.first { it.kind == "developer" }.rateLabel.startsWith("${DevFeePolicy.PERCENT}%"))
        assertFalse(s.layers.first { it.kind == "developer" }.adjustable)
    }
}
