package com.iml1s.xmrigminer.service

import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Fake-engine Start/Stop sequencing that mirrors MiningController (#124).
 * Does not touch WorkManager; proves latch transitions at the real call sites.
 */
class MiningControllerSessionSequenceTest {

    private val fakeEngine = FakeMiningEngine()

    @Before
    fun setUp() {
        MiningSessionLatch.resetForTests()
        fakeEngine.reset()
    }

    @After
    fun tearDown() {
        MiningSessionLatch.resetForTests()
    }

    @Test
    fun `successful Start arms then replaces engine without UserStopped`() {
        val result = fakeControllerStart(validConfig = true)
        assertTrue(result)
        assertFalse(MiningSessionLatch.isUserStopped())
        assertTrue(fakeEngine.enqueued)
        assertTrue(fakeEngine.cleanedUp)
        assertFalse(fakeEngine.userStopLatchedDuringCleanup)
    }

    @Test
    fun `invalid Start does not arm or clear prior Stop`() {
        MiningSessionLatch.latchUserStop()
        assertTrue(MiningSessionLatch.isUserStopped())
        val result = fakeControllerStart(validConfig = false)
        assertFalse(result)
        assertTrue(MiningSessionLatch.isUserStopped())
        assertFalse(fakeEngine.enqueued)
        assertFalse(fakeEngine.cleanedUp)
    }

    @Test
    fun `user Stop latches and cancels then later Start clears`() {
        assertTrue(fakeControllerStart(validConfig = true))
        fakeControllerUserStop()
        assertTrue(MiningSessionLatch.isUserStopped())
        assertTrue(fakeEngine.cancelled)

        fakeEngine.reset()
        assertTrue(fakeControllerStart(validConfig = true))
        assertFalse(MiningSessionLatch.isUserStopped())
    }

    @Test
    fun `policy pause cancels without UserStopped`() {
        assertTrue(fakeControllerStart(validConfig = true))
        fakeControllerPolicyPause()
        assertFalse(MiningSessionLatch.isUserStopped())
        assertTrue(MiningSessionLatch.isPolicyPaused())
        assertTrue(fakeEngine.cancelled)
    }

    @Test
    fun `newer user Stop blocks policy resume clear`() {
        assertTrue(fakeControllerStart(validConfig = true))
        fakeControllerPolicyPause()
        MiningSessionLatch.latchUserStop()
        assertFalse(MiningSessionLatch.clearPolicyPauseIfCurrent())
        assertTrue(MiningSessionLatch.isUserStopped())
    }

    /**
     * Mirrors MiningController.start latch order after validation.
     */
    private fun fakeControllerStart(validConfig: Boolean): Boolean {
        if (!validConfig) {
            // Early return — must not arm (#124).
            return false
        }
        if (!MiningSessionSequencer.onValidatedStartReady()) return false
        fakeEngine.replaceSessionCleanup()
        MiningSessionSequencer.onEngineReplaceCleanup()
        fakeEngine.enqueue()
        return true
    }

    private fun fakeControllerUserStop() {
        MiningSessionSequencer.onUserStop()
        fakeEngine.cancel()
    }

    private fun fakeControllerPolicyPause() {
        MiningSessionSequencer.onPolicyPause(0L)
        fakeEngine.cancel()
    }

    private class FakeMiningEngine {
        var cleanedUp = false
        var enqueued = false
        var cancelled = false
        var userStopLatchedDuringCleanup = false

        fun reset() {
            cleanedUp = false
            enqueued = false
            cancelled = false
            userStopLatchedDuringCleanup = false
        }

        fun replaceSessionCleanup() {
            cleanedUp = true
            userStopLatchedDuringCleanup = MiningSessionLatch.isUserStopped()
            cancelled = true
        }

        fun enqueue() {
            enqueued = true
        }

        fun cancel() {
            cancelled = true
        }
    }
}
