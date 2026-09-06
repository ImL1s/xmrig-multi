package com.iml1s.xmrigminer.data.hardware

import com.iml1s.xmrigminer.data.model.CoinType
import com.iml1s.xmrigminer.data.model.MiningConfig

/**
 * Consumer launch gate for RandomX memory (#129).
 * UI → persist → start must refuse when select() is blocked; OOM light retry
 * budget is session-owned so rebuilding policy does not reset the counter.
 */
object MemoryLaunchGate {

    data class Observation(
        val availableBytes: Long? = null,
        val totalBytes: Long? = null,
        val processLimitBytes: Long? = null
    )

    data class Verdict(
        val allowed: Boolean,
        val appliedMode: String?,
        val reasons: List<String>,
        val selection: RandomXMemoryBudget.Selection,
        val allocationCalls: Int = 0
    )

    /**
     * Session-scoped OOM light-retry budget. New [generation] resets usage.
     */
    class RetryBudget(private val maxRetries: Int = 1) {
        @Volatile private var generation: Long = -1L
        @Volatile private var used: Int = 0

        fun bind(generation: Long) {
            if (generation != this.generation) {
                this.generation = generation
                used = 0
            }
        }

        fun remaining(): Int = (maxRetries - used).coerceAtLeast(0)

        fun consume(): Boolean {
            if (used >= maxRetries) return false
            used += 1
            return true
        }
    }

    /** Spy allocator for unit tests — production native path uses XMRig. */
    class FakeAllocator {
        var cacheCreates: Int = 0
            private set
        var datasetCreates: Int = 0
            private set
        var live: Int = 0
            private set
        var released: Boolean = false
            private set

        fun createCache() {
            cacheCreates += 1
            live += 1
            released = false
        }

        fun createDataset() {
            datasetCreates += 1
            live += 1
            released = false
        }

        fun releaseAll() {
            live = 0
            released = true
        }
    }

    fun evaluate(
        config: MiningConfig,
        observation: Observation,
        allocationFailed: Boolean = false,
        confirmSoftOverride: Boolean = false,
        retryBudget: RetryBudget? = null,
        sessionGeneration: Long? = null,
        allocator: FakeAllocator? = null
    ): Verdict {
        if (sessionGeneration != null) {
            retryBudget?.bind(sessionGeneration)
        }
        if (allocationFailed && retryBudget != null && !retryBudget.consume()) {
            val denied = config.selectRandomxMode(
                availableBytes = observation.availableBytes,
                totalBytes = observation.totalBytes,
                processLimitBytes = observation.processLimitBytes,
                allocationFailed = false,
                confirmSoftOverride = confirmSoftOverride
            )
            return Verdict(
                allowed = false,
                appliedMode = null,
                reasons = listOf("OOM light retry budget exhausted for this session"),
                selection = denied,
                allocationCalls = 0
            )
        }

        val selection = config.selectRandomxMode(
            availableBytes = observation.availableBytes,
            totalBytes = observation.totalBytes,
            processLimitBytes = observation.processLimitBytes,
            allocationFailed = allocationFailed,
            confirmSoftOverride = confirmSoftOverride
        )

        if (!selection.ok || selection.blocked || selection.appliedMode.isNullOrBlank()) {
            return Verdict(
                allowed = false,
                appliedMode = null,
                reasons = selection.reasons.ifEmpty {
                    listOf("Memory hard/soft gate blocked RandomX launch")
                },
                selection = selection,
                allocationCalls = 0
            )
        }

        var calls = 0
        if (allocator != null) {
            allocator.createCache()
            calls += 1
            if (selection.appliedMode == "fast") {
                allocator.createDataset()
                calls += 1
            }
        }

        return Verdict(
            allowed = true,
            appliedMode = selection.appliedMode,
            reasons = selection.reasons,
            selection = selection,
            allocationCalls = calls
        )
    }

    fun algorithmFor(config: MiningConfig): String =
        when (config.getCoin()) {
            CoinType.WOWNERO -> "rx/wow"
            CoinType.DERO -> "astrobwt/v3"
            CoinType.MONERO -> "rx/0"
        }
}
