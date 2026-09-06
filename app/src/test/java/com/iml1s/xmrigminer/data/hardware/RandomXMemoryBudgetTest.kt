package com.iml1s.xmrigminer.data.hardware

import com.iml1s.xmrigminer.data.model.MiningConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
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
    fun `allocation failure retries light once when RAM allows`() {
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
    fun `allocation failure with 64MiB hard limit stays blocked`() {
        val mib = RandomXMemoryBudget.MIB
        val normal = RandomXMemoryBudget.select(
            requestedMode = "auto",
            threads = 1,
            availableBytes = 64 * mib,
            processLimitBytes = 64 * mib
        )
        assertTrue(normal.blocked)
        assertFalse(normal.ok)

        val oom = RandomXMemoryBudget.select(
            requestedMode = "auto",
            threads = 1,
            availableBytes = 64 * mib,
            processLimitBytes = 64 * mib,
            allocationFailed = true
        )
        assertTrue(oom.blocked)
        assertFalse(oom.ok)
        assertNull(oom.appliedMode)
        assertEquals(false, oom.estimate.fitsHardLimit)
    }

    @Test
    fun `wownero dataset matches XMRig 6210 base plus extra ceil`() {
        assertEquals(RandomXMemoryBudget.RX0.datasetMiB, RandomXMemoryBudget.RX_WOW.datasetMiB)
        assertTrue(RandomXMemoryBudget.RX_WOW.scratchpadMiB != RandomXMemoryBudget.RX0.scratchpadMiB)
        assertTrue(
            RandomXMemoryBudget.ENGINE_DATASET_MIB * RandomXMemoryBudget.MIB >=
                RandomXMemoryBudget.ENGINE_DATASET_BASE_PLUS_EXTRA_BYTES
        )
        val est = RandomXMemoryBudget.estimate(algorithm = "wownero", mode = "fast", threads = 2)
        val dataset = est.components.first { it.name == "dataset" }
        assertEquals(2080 * RandomXMemoryBudget.MIB, dataset.bytes)
        assertTrue(dataset.bytes >= RandomXMemoryBudget.ENGINE_DATASET_BASE_PLUS_EXTRA_BYTES)

        val blocked = RandomXMemoryBudget.select(
            algorithm = "rx/wow",
            requestedMode = "fast",
            locked = true,
            threads = 1,
            availableBytes = 4L * 1024 * RandomXMemoryBudget.MIB,
            processLimitBytes = 1024 * RandomXMemoryBudget.MIB
        )
        assertTrue(blocked.blocked)
        assertFalse(blocked.ok)
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

    @Test
    fun `MemoryLaunchGate blocked spy allocates nothing`() {
        val config = MiningConfig(
            poolUrl = "pool.supportxmr.com:3333",
            walletAddress = "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge",
            randomxMode = "auto",
            threads = 1,
            threadsAuto = false
        )
        val allocator = MemoryLaunchGate.FakeAllocator()
        val mib = RandomXMemoryBudget.MIB
        val verdict = MemoryLaunchGate.evaluate(
            config = config,
            observation = MemoryLaunchGate.Observation(
                availableBytes = 64 * mib,
                processLimitBytes = 64 * mib
            ),
            allocationFailed = true,
            allocator = allocator
        )
        assertFalse(verdict.allowed)
        assertEquals(0, allocator.cacheCreates)
        assertEquals(0, allocator.datasetCreates)
        assertEquals(0, allocator.live)
    }

    @Test
    fun `MemoryLaunchGate OOM retry budget is session scoped`() {
        val config = MiningConfig(
            poolUrl = "pool.supportxmr.com:3333",
            walletAddress = "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge",
            randomxMode = "auto",
            threads = 1,
            threadsAuto = false
        )
        val budget = MemoryLaunchGate.RetryBudget(1)
        val obs = MemoryLaunchGate.Observation(availableBytes = 8L * 1024 * RandomXMemoryBudget.MIB)
        val first = MemoryLaunchGate.evaluate(
            config, obs, allocationFailed = true, retryBudget = budget, sessionGeneration = 7L
        )
        assertTrue(first.allowed)
        assertEquals("light", first.appliedMode)

        val second = MemoryLaunchGate.evaluate(
            config, obs, allocationFailed = true, retryBudget = budget, sessionGeneration = 7L
        )
        assertFalse(second.allowed)
        assertTrue(second.reasons.any { it.contains("budget exhausted", ignoreCase = true) })

        val nextGen = MemoryLaunchGate.evaluate(
            config, obs, allocationFailed = true, retryBudget = budget, sessionGeneration = 8L
        )
        assertTrue(nextGen.allowed)
    }

    @Test
    fun `MiningConfig resolvedRandomxMode null when hard blocked`() {
        val config = MiningConfig(
            poolUrl = "pool.supportxmr.com:3333",
            walletAddress = "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge",
            randomxMode = "light",
            threads = 1,
            threadsAuto = false
        )
        val mib = RandomXMemoryBudget.MIB
        assertNull(
            config.resolvedRandomxMode(
                availableBytes = 64 * mib,
                processLimitBytes = 64 * mib
            )
        )
    }
}
