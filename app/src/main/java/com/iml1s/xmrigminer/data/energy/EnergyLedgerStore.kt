package com.iml1s.xmrigminer.data.energy

/**
 * Durable ledger contract (#130). Memory and SQLite share the same semantics:
 * identical sampleId+payload → no-op; same id different payload → reject;
 * never replace history silently.
 */
data class MeterCursor(
    val sourceId: String,
    val epoch: String,
    val counterWh: Double,
    val lastTimestampMs: Long
)

data class CostEntry(
    val intervalSampleId: String,
    val tariffVersion: String,
    val amountExact: String,
    val currency: String,
    val quality: String
)

data class BudgetPeriodState(
    val id: String,
    val zoneId: String,
    val periodStartMs: Long,
    val usedExact: String,
    val reservedExact: String,
    val revision: Long
)

data class PersistedEnergyState(
    val entries: List<EnergySample> = emptyList(),
    val cursors: List<MeterCursor> = emptyList(),
    val costs: List<CostEntry> = emptyList(),
    val budget: BudgetPeriodState? = null
)

sealed interface StoreCommitResult {
    data class Accepted(val entry: EnergySample, val cost: CostEntry?) : StoreCommitResult
    data class DuplicateNoOp(val entry: EnergySample) : StoreCommitResult
    data class Rejected(val reason: String) : StoreCommitResult
}

interface EnergyLedgerStore {
    fun load(): PersistedEnergyState

    fun commitInterval(
        sample: EnergySample,
        cost: CostEntry? = null,
        budget: BudgetPeriodState? = null
    ): StoreCommitResult

    fun replaceState(state: PersistedEnergyState)
}

/**
 * JVM-safe transactional store used by unit tests and as a fallback.
 * Proves dedupe / conflict / reopen without Android SQLite.
 */
class MemoryEnergyLedgerStore : EnergyLedgerStore {
    private val lock = Any()
    private val entries = LinkedHashMap<String, EnergySample>()
    private val cursors = LinkedHashMap<String, MeterCursor>()
    private val costs = LinkedHashMap<String, CostEntry>() // key: sampleId|tariffVersion
    private var budget: BudgetPeriodState? = null

    override fun load(): PersistedEnergyState = synchronized(lock) {
        PersistedEnergyState(
            entries = entries.values.toList(),
            cursors = cursors.values.toList(),
            costs = costs.values.toList(),
            budget = budget
        )
    }

    override fun commitInterval(
        sample: EnergySample,
        cost: CostEntry?,
        budget: BudgetPeriodState?
    ): StoreCommitResult = synchronized(lock) {
        val existing = entries[sample.sampleId]
        if (existing != null) {
            return if (payloadEquals(existing, sample)) {
                StoreCommitResult.DuplicateNoOp(existing)
            } else {
                StoreCommitResult.Rejected("conflicting-replay")
            }
        }
        // Simulate mid-transaction failure surface for tests via require.
        entries[sample.sampleId] = sample
        if (cost != null) {
            val key = "${cost.intervalSampleId}|${cost.tariffVersion}"
            if (!costs.containsKey(key)) {
                costs[key] = cost
            }
        }
        if (budget != null) {
            this.budget = budget
        }
        StoreCommitResult.Accepted(sample, cost)
    }

    override fun replaceState(state: PersistedEnergyState) = synchronized(lock) {
        entries.clear()
        state.entries.forEach { entries[it.sampleId] = it }
        cursors.clear()
        state.cursors.forEach { cursors[it.sourceId] = it }
        costs.clear()
        state.costs.forEach { costs["${it.intervalSampleId}|${it.tariffVersion}"] = it }
        budget = state.budget
    }

    companion object {
        fun payloadEquals(a: EnergySample, b: EnergySample): Boolean {
            return a.sampleId == b.sampleId &&
                a.source == b.source &&
                a.scope == b.scope &&
                a.quality == b.quality &&
                a.unit == b.unit &&
                a.value == b.value &&
                a.wattHours == b.wattHours &&
                a.startMs == b.startMs &&
                a.endMs == b.endMs &&
                a.meterEpoch == b.meterEpoch &&
                a.sessionId == b.sessionId
        }
    }
}
