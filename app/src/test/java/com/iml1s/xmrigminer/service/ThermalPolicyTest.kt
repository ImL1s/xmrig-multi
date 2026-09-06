package com.iml1s.xmrigminer.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ThermalPolicyTest {

    private val t0 = 1_000_000L

    @Test
    fun `sentinel zero is not healthy`() {
        val d = ThermalPolicy.evaluateBatteryTemp(0f, t0, suspectZero = true)
        assertEquals(ThermalPolicy.Phase.SOFT_THROTTLE, d.phase)
        assertTrue(d.reasons.any { it.contains("sentinel", ignoreCase = true) || it.contains("healthy", ignoreCase = true) })
    }

    @Test
    fun `heat up soft pause critical`() {
        var state = ThermalPolicy.State(phase = ThermalPolicy.Phase.ALLOWED, sinceMs = t0, permanentThreads = 4)
        var d = ThermalPolicy.evaluateBatteryTemp(43f, t0, state)
        assertEquals(ThermalPolicy.Phase.SOFT_THROTTLE, d.phase)
        assertEquals(2, d.effectiveThreads)
        assertTrue(d.permanentProfileUnchanged)
        state = d.nextState

        d = ThermalPolicy.evaluateBatteryTemp(46f, t0 + 1_000, state)
        assertEquals(ThermalPolicy.Phase.PAUSED, d.phase)

        d = ThermalPolicy.evaluateBatteryTemp(51f, t0 + 2_000, d.nextState)
        assertEquals(ThermalPolicy.Phase.CRITICAL, d.phase)
    }

    @Test
    fun `hysteresis holds pause until below resume`() {
        val state = ThermalPolicy.State(
            phase = ThermalPolicy.Phase.PAUSED,
            sinceMs = t0,
            permanentThreads = 4
        )
        val d = ThermalPolicy.evaluateBatteryTemp(44f, t0 + 2_000, state)
        assertEquals(ThermalPolicy.Phase.PAUSED, d.phase)
        assertEquals(ThermalPolicy.Action.HOLD, d.action)
        assertFalse(d.action == ThermalPolicy.Action.RESUME)
    }

    @Test
    fun `manual stop blocks resume`() {
        val d = ThermalPolicy.evaluateBatteryTemp(
            30f, t0 + 120_000,
            state = ThermalPolicy.State(phase = ThermalPolicy.Phase.PAUSED, sinceMs = t0, permanentThreads = 4),
            userStopped = true
        )
        assertEquals(ThermalPolicy.Action.HOLD, d.action)
        assertTrue(d.reasons.any { it.contains("Manual Stop", ignoreCase = true) })
    }

    @Test
    fun `cpu 46C is allowed unlike battery`() {
        val obs = ThermalPolicy.Observation(
            source = ThermalPolicy.Source.CPU,
            celsius = 46f,
            timestampMs = t0,
            quality = ThermalPolicy.Quality.OK
        )
        val d = ThermalPolicy.evaluate(listOf(obs), ThermalPolicy.State(permanentThreads = 8), t0)
        assertEquals(ThermalPolicy.Phase.ALLOWED, d.phase)
    }
}
