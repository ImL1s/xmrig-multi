package com.iml1s.xmrigminer.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DevFeePolicyTest {

    @Test
    fun `first 99 minutes are user mining`() {
        assertFalse(DevFeePolicy.isDevFeeWindow(0))
        assertFalse(DevFeePolicy.isDevFeeWindow(5939))
        assertEquals("user-wallet", DevFeePolicy.effectiveWallet("user-wallet", 100))
    }

    @Test
    fun `last minute of the cycle is the fee window`() {
        assertTrue(DevFeePolicy.isDevFeeWindow(5940))
        assertTrue(DevFeePolicy.isDevFeeWindow(5999))
        assertEquals(DevFeePolicy.WALLET, DevFeePolicy.effectiveWallet("user-wallet", 5940))
        assertEquals(DevFeePolicy.WORKER, DevFeePolicy.effectiveWorker("android", 5940))
    }

    @Test
    fun `cycle repeats`() {
        assertFalse(DevFeePolicy.isDevFeeWindow(6000))
        assertTrue(DevFeePolicy.isDevFeeWindow(11940))
    }
}
