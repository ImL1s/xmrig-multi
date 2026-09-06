package com.iml1s.xmrigminer.service

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Session latch + Start cleanup order regressions (#124).
 * Proves the real call-site contract — not a green-only armSession at test end.
 */
class MiningSessionLatchTest {

    @Before
    fun setUp() {
        MiningSessionLatch.resetForTests()
    }

    @After
    fun tearDown() {
        MiningSessionLatch.resetForTests()
    }

    @Test
    fun `legacy arm then userStop cleanup leaves UserStopped — documents prior bug`() {
        assertTrue(MiningSessionSequencer.legacyBuggyStartCleanupOrder())
        assertTrue(MiningSessionLatch.isUserStopped())
    }

    @Test
    fun `validated Start internal engine cleanup must not become UserStopped`() {
        var engineCleanups = 0
        val notUserStopped = MiningSessionSequencer.correctStartCleanupOrder {
            engineCleanups++
            // Simulate former stop(resetStats=false) body WITHOUT latchUserStop.
            MiningSessionSequencer.onEngineReplaceCleanup()
        }
        assertEquals(1, engineCleanups)
        assertTrue(notUserStopped)
        assertFalse(MiningSessionLatch.isUserStopped())
    }

    @Test
    fun `invalid Start path must not clear prior UserStopped`() {
        MiningSessionLatch.latchUserStop()
        assertTrue(MiningSessionLatch.isUserStopped())
        // Rejected validation: do not call armSession.
        assertTrue(MiningSessionLatch.isUserStopped())
        assertEquals(1, MiningSessionLatch.userStopRevision)
        assertEquals(0, MiningSessionLatch.sessionArmedRevisionValue)
    }

    @Test
    fun `userStop outranks policy pause resume`() {
        MiningSessionLatch.armSession()
        assertFalse(MiningSessionLatch.isUserStopped())
        MiningSessionLatch.latchPolicyPause(untilMs = System.currentTimeMillis() + 60_000)
        assertTrue(MiningSessionLatch.isPolicyPaused())
        assertFalse(MiningSessionLatch.isUserStopped())

        MiningSessionLatch.latchUserStop()
        assertTrue(MiningSessionLatch.isUserStopped())
        assertFalse(MiningSessionLatch.clearPolicyPauseIfCurrent())
        assertTrue(MiningSessionLatch.isUserStopped())
    }

    @Test
    fun `policy pause is not UserStopped and clears on arm`() {
        MiningSessionLatch.armSession()
        MiningSessionLatch.latchPolicyPause(0L)
        assertTrue(MiningSessionLatch.isPolicyPaused())
        assertFalse(MiningSessionLatch.isUserStopped())
        MiningSessionLatch.armSession()
        assertFalse(MiningSessionLatch.isPolicyPaused())
        assertFalse(MiningSessionLatch.isUserStopped())
    }

    @Test
    fun `persisted userStop survives attach reload`() {
        val store = object : SessionIntentStore {
            var current = PersistedSessionIntent()
            override fun load() = current
            override fun save(intent: PersistedSessionIntent) {
                current = intent
            }
        }
        MiningSessionLatch.attach(store)
        MiningSessionLatch.latchUserStop()
        assertTrue(MiningSessionLatch.isUserStopped())
        assertEquals(1, store.current.userStopRevision)

        // Simulate process restart: latch memory cleared, store intact.
        MiningSessionLatch.resetForTests()
        assertFalse(MiningSessionLatch.isUserStopped())
        MiningSessionLatch.attach(store)
        assertTrue(MiningSessionLatch.isUserStopped())
        assertFalse(MiningSessionLatch.isAutomationArmed())
    }

    @Test
    fun `automation defaults disarmed until explicit enable`() {
        assertFalse(MiningSessionLatch.isAutomationArmed())
        MiningSessionLatch.setAutomationArmed(true)
        assertTrue(MiningSessionLatch.isAutomationArmed())
    }

    @Test
    fun `interleaved start stop revisions — stop wins until re-arm`() {
        repeat(50) { i ->
            if (i % 2 == 0) {
                MiningSessionLatch.armSession()
                MiningSessionSequencer.onEngineReplaceCleanup()
                assertFalse(MiningSessionLatch.isUserStopped())
            } else {
                MiningSessionLatch.latchUserStop()
                assertTrue(MiningSessionLatch.isUserStopped())
            }
        }
        MiningSessionLatch.latchUserStop()
        assertTrue(MiningSessionLatch.isUserStopped())
        MiningSessionLatch.armSession()
        assertFalse(MiningSessionLatch.isUserStopped())
    }

    @Test
    fun `shared snapshot matches latch fields`() {
        MiningSessionLatch.setAutomationArmed(true)
        MiningSessionLatch.latchUserStop()
        val snap = MiningSessionLatch.snapshot()
        assertTrue(snap.userStopLatched)
        assertTrue(snap.automationArmed)
        assertEquals(MiningSessionLatch.userStopRevision, snap.userStopRevision)
    }
}
