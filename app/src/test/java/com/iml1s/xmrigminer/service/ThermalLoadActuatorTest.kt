package com.iml1s.xmrigminer.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Fake-engine soft-throttle actuation (#125).
 * Proves commands are issued and readback is required before claiming applied.
 */
class ThermalLoadActuatorTest {

    @Test
    fun `soft throttle applies when engine returns requested threads`() {
        val calls = mutableListOf<Int>()
        val outcome = ThermalLoadActuator.applySoftThrottle(
            requestedThreads = 2,
            permanentThreads = 4,
            sessionGeneration = 1L,
            reason = "hot",
            engineSupportsHotApply = false,
            engineApply = { cmd ->
                calls += cmd.requestedThreads
                cmd.requestedThreads
            }
        )
        assertEquals(listOf(2), calls)
        assertEquals(ThermalLoadActuator.Status.APPLIED, outcome.status)
        assertEquals(2, outcome.appliedThreads)
        assertFalse(outcome.shouldPauseSafely)
    }

    @Test
    fun `actuation failure pauses safely and does not claim applied`() {
        val outcome = ThermalLoadActuator.applySoftThrottle(
            requestedThreads = 2,
            permanentThreads = 4,
            sessionGeneration = 1L,
            reason = "hot",
            engineSupportsHotApply = false,
            engineApply = { null }
        )
        assertEquals(ThermalLoadActuator.Status.UNSUPPORTED, outcome.status)
        assertTrue(outcome.shouldPauseSafely)
        assertEquals(null, outcome.appliedThreads)
    }

    @Test
    fun `mismatched readback is failure not applied`() {
        val outcome = ThermalLoadActuator.applySoftThrottle(
            requestedThreads = 2,
            permanentThreads = 4,
            sessionGeneration = 1L,
            reason = "hot",
            engineSupportsHotApply = false,
            engineApply = { 4 }
        )
        assertEquals(ThermalLoadActuator.Status.FAILED, outcome.status)
        assertTrue(outcome.shouldPauseSafely)
    }

    @Test
    fun `restore permanent threads`() {
        val outcome = ThermalLoadActuator.restorePermanent(
            permanentThreads = 4,
            sessionGeneration = 2L,
            engineApply = { 4 }
        )
        assertEquals(ThermalLoadActuator.Status.APPLIED, outcome.status)
        assertEquals(4, outcome.appliedThreads)
    }
}
