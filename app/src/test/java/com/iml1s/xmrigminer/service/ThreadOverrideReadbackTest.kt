package com.iml1s.xmrigminer.service

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Regression for #125 thermal resume: clear sets override null; verify must still
 * accept permanent DataStore threads so lastAppliedSoftThreads can unset.
 */
class ThreadOverrideReadbackTest {

    @Test
    fun `soft throttle verify requires matching override`() {
        assertTrue(
            MiningController.matchesThreadOverrideReadback(
                runtimeOverride = 2,
                expectedThreads = 2,
                permanentThreads = 4
            )
        )
        assertFalse(
            MiningController.matchesThreadOverrideReadback(
                runtimeOverride = 4,
                expectedThreads = 2,
                permanentThreads = 4
            )
        )
    }

    @Test
    fun `clear path verify accepts null override when expected equals permanent`() {
        assertTrue(
            MiningController.matchesThreadOverrideReadback(
                runtimeOverride = null,
                expectedThreads = 4,
                permanentThreads = 4
            )
        )
    }

    @Test
    fun `clear path verify rejects null override when expected is soft target`() {
        assertFalse(
            MiningController.matchesThreadOverrideReadback(
                runtimeOverride = null,
                expectedThreads = 2,
                permanentThreads = 4
            )
        )
    }
}
