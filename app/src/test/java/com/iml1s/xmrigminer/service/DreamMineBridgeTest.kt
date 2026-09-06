package com.iml1s.xmrigminer.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DreamMineBridgeTest {

    @Test
    fun `preview decision never requests controller`() {
        val decision = DreamMiningPolicy.decide(
            phase = DreamMiningPolicy.Phase.PREVIEW,
            userOptedInClockAndMine = true,
            powerAllows = true,
            runtimeEligible = true,
            userStopped = false
        )
        assertFalse(DreamMineBridge.shouldRequest(decision, alreadyRequestedThisDream = false))
    }

    @Test
    fun `eligible dream requests once then blocks duplicate`() {
        val decision = DreamMiningPolicy.decide(
            phase = DreamMiningPolicy.Phase.DREAMING,
            userOptedInClockAndMine = true,
            powerAllows = true,
            runtimeEligible = true,
            userStopped = false
        )
        assertTrue(DreamMineBridge.shouldRequest(decision, alreadyRequestedThisDream = false))
        assertFalse(DreamMineBridge.shouldRequest(decision, alreadyRequestedThisDream = true))
    }

    @Test
    fun `controller accept keeps dream scoped flag`() {
        val (keep, outcome) = DreamMineBridge.afterControllerResult(MiningStartResult.Started)
        assertTrue(keep)
        assertTrue(outcome.accepted)
        assertNull(outcome.rejectReason)
    }

    @Test
    fun `controller reject clears flag and returns reason`() {
        val (keep, outcome) = DreamMineBridge.afterControllerResult(
            MiningStartResult.InvalidConfig("need wallet")
        )
        assertFalse(keep)
        assertFalse(outcome.accepted)
        assertEquals("need wallet", outcome.rejectReason)
        assertTrue(outcome.requested)
    }
}
