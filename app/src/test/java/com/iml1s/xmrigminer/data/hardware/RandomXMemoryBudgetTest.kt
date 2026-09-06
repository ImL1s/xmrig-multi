package com.iml1s.xmrigminer.data.hardware

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RandomXMemoryBudgetTest {

    @Test
    fun `scratchpad is not full mode total RAM`() {
        val est = RandomXMemoryBudget.estimate(mode = "fast", threads = 1)
        val scratch = est.components.first { it.name == "scratchpad" }
        val dataset = est.components.first { it.name == "dataset" }
        assertEquals(2 * RandomXMemoryBudget.MIB, scratch.bytes)
        assertEquals(2080 * RandomXMemoryBudget.MIB, dataset.bytes)
        assertTrue(dataset.bytes > scratch.bytes * 100)
        assertTrue(est.warnings.any { it.contains("Scratchpad", ignoreCase = true) })
    }

    @Test
    fun `summary rejects legacy Full mode 2MB wording`() {
        val (title, detail) = RandomXMemoryBudget.algorithmSummary("monero", "auto", 4)
        assertFalse(RandomXMemoryBudget.isMisleadingFullModeLabel(title))
        assertFalse(RandomXMemoryBudget.isMisleadingFullModeLabel(detail))
        assertTrue(detail.contains("Scratchpad", ignoreCase = true))
        assertTrue(RandomXMemoryBudget.isMisleadingFullModeLabel("RandomX - Full mode (2MB)"))
    }

    @Test
    fun `low RAM auto selects light`() {
        val sel = RandomXMemoryBudget.select(
            requestedMode = "auto",
            threads = 3,
            availableBytes = 1610612736L,
            totalBytes = 2147483648L
        )
        assertEquals("light", sel.appliedMode)
    }

    @Test
    fun `unknown memory prefers light and locks block auto overwrite`() {
        val auto = RandomXMemoryBudget.select(requestedMode = "auto", threads = 4)
        assertEquals("light", auto.appliedMode)

        val locked = RandomXMemoryBudget.select(
            requestedMode = "fast",
            locked = true,
            threads = 4,
            availableBytes = null
        )
        assertTrue(locked.blocked)
        assertFalse(locked.fallbackApplied)
        assertTrue(locked.requiresSoftConfirm)
    }

    @Test
    fun `allocation failure retries light once`() {
        val sel = RandomXMemoryBudget.select(
            requestedMode = "auto",
            threads = 4,
            availableBytes = 8L * 1024 * 1024 * 1024,
            allocationFailed = true
        )
        assertEquals("light", sel.appliedMode)
        assertTrue(sel.fallbackApplied)
        assertNotNull(sel.retryHint)
    }

    @Test
    fun `wownero uses own dataset constants`() {
        assertTrue(RandomXMemoryBudget.RX_WOW.datasetMiB != RandomXMemoryBudget.RX0.datasetMiB)
        val est = RandomXMemoryBudget.estimate(algorithm = "wownero", mode = "fast", threads = 2)
        val dataset = est.components.first { it.name == "dataset" }
        assertEquals(256 * RandomXMemoryBudget.MIB, dataset.bytes)
    }

    @Test
    fun `hard process limit cannot be soft overridden`() {
        val sel = RandomXMemoryBudget.select(
            requestedMode = "fast",
            locked = true,
            threads = 2,
            availableBytes = 16L * 1024 * 1024 * 1024,
            processLimitBytes = 100L * 1024 * 1024,
            confirmSoftOverride = true
        )
        assertFalse(sel.ok)
        assertTrue(sel.blocked)
        assertTrue(sel.reasons.any { it.contains("Hard", ignoreCase = true) })
    }
}
