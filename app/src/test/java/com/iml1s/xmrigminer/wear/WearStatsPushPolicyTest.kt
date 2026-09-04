package com.iml1s.xmrigminer.wear

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WearStatsPushPolicyTest {

    @Test
    fun `force and running changes are not throttled`() {
        assertTrue(WearStatsPushPolicy.shouldPush(1_000L, 1_000L, runningChanged = true, force = false))
        assertTrue(WearStatsPushPolicy.shouldPush(1_000L, 1_000L, runningChanged = false, force = true))
        assertTrue(WearStatsPushPolicy.urgent(runningChanged = true, force = false))
        assertTrue(WearStatsPushPolicy.urgent(runningChanged = false, force = true))
    }

    @Test
    fun `routine ticks wait for the interval`() {
        assertFalse(WearStatsPushPolicy.shouldPush(10_000L, 0L, runningChanged = false, force = false))
        assertTrue(
            WearStatsPushPolicy.shouldPush(
                WearStatsPushPolicy.INTERVAL_MS,
                0L,
                runningChanged = false,
                force = false
            )
        )
        assertFalse(WearStatsPushPolicy.urgent(runningChanged = false, force = false))
    }
}
