package com.iml1s.xmrigminer.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DreamMiningPolicyTest {

    @Test
    fun `preview never allows mine request`() {
        val d = DreamMiningPolicy.decide(
            phase = DreamMiningPolicy.Phase.PREVIEW,
            userOptedInClockAndMine = true,
            powerAllows = true,
            runtimeEligible = true,
            userStopped = false
        )
        assertFalse(d.mayRequestMine)
        assertTrue(d.showClock)
    }

    @Test
    fun `dreaming without opt-in is clock only`() {
        val d = DreamMiningPolicy.decide(
            phase = DreamMiningPolicy.Phase.DREAMING,
            userOptedInClockAndMine = false,
            powerAllows = true,
            runtimeEligible = true,
            userStopped = false
        )
        assertFalse(d.mayRequestMine)
    }

    @Test
    fun `user stop blocks revive in dream`() {
        val d = DreamMiningPolicy.decide(
            phase = DreamMiningPolicy.Phase.DREAMING,
            userOptedInClockAndMine = true,
            powerAllows = true,
            runtimeEligible = true,
            userStopped = true
        )
        assertFalse(d.mayRequestMine)
        assertTrue(d.reasons.any { it.contains("Stop") })
    }

    @Test
    fun `eligible dream may request shared controller`() {
        val d = DreamMiningPolicy.decide(
            phase = DreamMiningPolicy.Phase.DREAMING,
            userOptedInClockAndMine = true,
            powerAllows = true,
            runtimeEligible = true,
            userStopped = false
        )
        assertTrue(d.mayRequestMine)
        assertEquals(DreamMiningPolicy.Phase.DREAMING, d.phase)
    }

    @Test
    fun `settings guide points at system dream settings`() {
        assertEquals("android.settings.DREAM_SETTINGS", DreamSettingsGuide.ACTION_DREAM_SETTINGS)
        assertTrue(DreamSettingsGuide.BODY.contains("Preview never mines"))
    }

    @Test
    fun `session latch blocks dream mine when stopped`() {
        MiningSessionLatch.latchUserStop()
        assertTrue(MiningSessionLatch.isUserStopped())
        val d = DreamMiningPolicy.decide(
            phase = DreamMiningPolicy.Phase.DREAMING,
            userOptedInClockAndMine = true,
            powerAllows = true,
            runtimeEligible = true,
            userStopped = MiningSessionLatch.isUserStopped()
        )
        assertFalse(d.mayRequestMine)
        MiningSessionLatch.armSession()
        assertFalse(MiningSessionLatch.isUserStopped())
    }
}
