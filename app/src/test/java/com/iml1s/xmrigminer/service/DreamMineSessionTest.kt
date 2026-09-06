package com.iml1s.xmrigminer.service

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DreamMineSessionTest {

    @Test
    fun `preview never invokes controller spy`() = runBlocking {
        var calls = 0
        val session = DreamMineSession(
            startMining = {
                calls++
                MiningStartResult.Started
            },
            stillDreaming = { true }
        )
        val decision = DreamMiningPolicy.decide(
            phase = DreamMiningPolicy.Phase.PREVIEW,
            userOptedInClockAndMine = true,
            powerAllows = true,
            runtimeEligible = true,
            userStopped = false
        )
        assertNull(session.maybeRequest(decision))
        assertEquals(0, calls)
        assertEquals(0, session.requestCount)
    }

    @Test
    fun `eligible dream invokes spy and records accept`() = runBlocking {
        var calls = 0
        val session = DreamMineSession(
            startMining = {
                calls++
                MiningStartResult.Started
            },
            stillDreaming = { true }
        )
        val decision = DreamMiningPolicy.decide(
            phase = DreamMiningPolicy.Phase.DREAMING,
            userOptedInClockAndMine = true,
            powerAllows = true,
            runtimeEligible = true,
            userStopped = false
        )
        val outcome = session.maybeRequest(decision)!!
        assertTrue(outcome.accepted)
        assertEquals(1, calls)
        assertEquals(1, session.requestCount)
        assertEquals(1, session.acceptedCount)
        assertNull(session.maybeRequest(decision))
        assertEquals(1, calls)
    }

    @Test
    fun `reject reason returned and flag cleared for retry`() = runBlocking {
        val session = DreamMineSession(
            startMining = { MiningStartResult.InvalidConfig("need wallet") },
            stillDreaming = { true }
        )
        val decision = DreamMiningPolicy.decide(
            phase = DreamMiningPolicy.Phase.DREAMING,
            userOptedInClockAndMine = true,
            powerAllows = true,
            runtimeEligible = true,
            userStopped = false
        )
        val outcome = session.maybeRequest(decision)!!
        assertFalse(outcome.accepted)
        assertEquals("need wallet", outcome.rejectReason)
        assertFalse(session.requestedThisDream)
        assertEquals(1, session.requestCount)
        assertEquals(0, session.acceptedCount)
    }

    @Test
    fun `stop before start skips controller`() = runBlocking {
        var calls = 0
        var dreaming = true
        val session = DreamMineSession(
            startMining = {
                calls++
                MiningStartResult.Started
            },
            stillDreaming = { dreaming }
        )
        dreaming = false
        val decision = DreamMiningPolicy.decide(
            phase = DreamMiningPolicy.Phase.DREAMING,
            userOptedInClockAndMine = true,
            powerAllows = true,
            runtimeEligible = true,
            userStopped = false
        )
        assertNull(session.maybeRequest(decision))
        assertEquals(0, calls)
    }
}
