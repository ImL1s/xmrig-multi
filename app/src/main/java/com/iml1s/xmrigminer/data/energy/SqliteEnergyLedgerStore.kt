package com.iml1s.xmrigminer.data.energy

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * SQLiteOpenHelper ledger (#130). API 21-safe (no UPSERT). Same semantics as [MemoryEnergyLedgerStore].
 */
class SqliteEnergyLedgerStore(
    context: Context,
    dbName: String = "energy_ledger.db"
) : EnergyLedgerStore {

    private val helper = Helper(context.applicationContext, dbName)

    override fun load(): PersistedEnergyState {
        val db = helper.readableDatabase
        val entries = mutableListOf<EnergySample>()
        db.rawQuery(
            """SELECT sampleId,source,scope,quality,unit,value,wattHours,startMs,endMs,
               meterEpoch,sessionId,unknownReason FROM energy_intervals ORDER BY startMs ASC""",
            null
        ).use { c ->
            while (c.moveToNext()) {
                val quality = runCatching { EnergyQuality.valueOf(c.getString(3)) }
                    .getOrDefault(EnergyQuality.UNKNOWN)
                val scope = EnergyScope.fromWire(c.getString(2)) ?: EnergyScope.MANUAL
                entries += EnergySample(
                    sampleId = c.getString(0),
                    source = c.getString(1),
                    scope = scope,
                    quality = quality,
                    unit = c.getString(4),
                    value = if (c.isNull(5)) null else c.getDouble(5),
                    wattHours = if (c.isNull(6)) null else c.getDouble(6),
                    startMs = c.getLong(7),
                    endMs = c.getLong(8),
                    meterEpoch = c.getString(9) ?: "default",
                    sessionId = c.getString(10),
                    unknownReason = c.getString(11)
                )
            }
        }
        val cursors = mutableListOf<MeterCursor>()
        db.rawQuery(
            "SELECT sourceId,epoch,counterWh,lastTimestampMs FROM meter_cursors",
            null
        ).use { c ->
            while (c.moveToNext()) {
                cursors += MeterCursor(
                    sourceId = c.getString(0),
                    epoch = c.getString(1),
                    counterWh = c.getDouble(2),
                    lastTimestampMs = c.getLong(3)
                )
            }
        }
        val costs = mutableListOf<CostEntry>()
        db.rawQuery(
            "SELECT intervalSampleId,tariffVersion,amountExact,currency,quality FROM cost_entries",
            null
        ).use { c ->
            while (c.moveToNext()) {
                costs += CostEntry(
                    intervalSampleId = c.getString(0),
                    tariffVersion = c.getString(1),
                    amountExact = c.getString(2),
                    currency = c.getString(3),
                    quality = c.getString(4)
                )
            }
        }
        var budget: BudgetPeriodState? = null
        db.rawQuery(
            "SELECT id,zoneId,periodStartMs,usedExact,reservedExact,revision FROM budget_periods LIMIT 1",
            null
        ).use { c ->
            if (c.moveToFirst()) {
                budget = BudgetPeriodState(
                    id = c.getString(0),
                    zoneId = c.getString(1),
                    periodStartMs = c.getLong(2),
                    usedExact = c.getString(3),
                    reservedExact = c.getString(4),
                    revision = c.getLong(5)
                )
            }
        }
        return PersistedEnergyState(entries, cursors, costs, budget)
    }

    override fun commitInterval(
        sample: EnergySample,
        cost: CostEntry?,
        budget: BudgetPeriodState?
    ): StoreCommitResult {
        val db = helper.writableDatabase
        db.beginTransaction()
        try {
            db.rawQuery(
                "SELECT source,scope,quality,unit,value,wattHours,startMs,endMs,meterEpoch,sessionId FROM energy_intervals WHERE sampleId=?",
                arrayOf(sample.sampleId)
            ).use { c ->
                if (c.moveToFirst()) {
                    val existing = EnergySample(
                        sampleId = sample.sampleId,
                        source = c.getString(0),
                        scope = EnergyScope.fromWire(c.getString(1)) ?: EnergyScope.MANUAL,
                        quality = runCatching { EnergyQuality.valueOf(c.getString(2)) }
                            .getOrDefault(EnergyQuality.UNKNOWN),
                        unit = c.getString(3),
                        value = if (c.isNull(4)) null else c.getDouble(4),
                        wattHours = if (c.isNull(5)) null else c.getDouble(5),
                        startMs = c.getLong(6),
                        endMs = c.getLong(7),
                        meterEpoch = c.getString(8) ?: "default",
                        sessionId = c.getString(9)
                    )
                    return if (MemoryEnergyLedgerStore.payloadEquals(existing, sample)) {
                        StoreCommitResult.DuplicateNoOp(existing)
                    } else {
                        StoreCommitResult.Rejected("conflicting-replay")
                    }
                }
            }

            val values = ContentValues().apply {
                put("sampleId", sample.sampleId)
                put("source", sample.source)
                put("scope", sample.scope.wire())
                put("quality", sample.quality.name)
                put("unit", sample.unit)
                if (sample.value == null) putNull("value") else put("value", sample.value)
                if (sample.wattHours == null) putNull("wattHours") else put("wattHours", sample.wattHours)
                put("startMs", sample.startMs)
                put("endMs", sample.endMs)
                put("startUTC", sample.utcMs)
                put("endUTC", sample.utcMs)
                put("startMono", sample.monotonicMs)
                put("endMono", sample.monotonicMs)
                put("meterEpoch", sample.meterEpoch)
                put("sessionId", sample.sessionId)
                put("unknownReason", sample.unknownReason)
            }
            if (db.insertOrThrow("energy_intervals", null, values) < 0) {
                return StoreCommitResult.Rejected("insert-failed")
            }

            if (cost != null) {
                val costCv = ContentValues().apply {
                    put("intervalSampleId", cost.intervalSampleId)
                    put("tariffVersion", cost.tariffVersion)
                    put("amountExact", cost.amountExact)
                    put("currency", cost.currency)
                    put("quality", cost.quality)
                }
                db.insertWithOnConflict(
                    "cost_entries",
                    null,
                    costCv,
                    SQLiteDatabase.CONFLICT_IGNORE
                )
            }

            if (budget != null) {
                db.delete("budget_periods", null, null)
                val bCv = ContentValues().apply {
                    put("id", budget.id)
                    put("zoneId", budget.zoneId)
                    put("periodStartMs", budget.periodStartMs)
                    put("usedExact", budget.usedExact)
                    put("reservedExact", budget.reservedExact)
                    put("revision", budget.revision)
                }
                db.insertOrThrow("budget_periods", null, bCv)
            }

            db.setTransactionSuccessful()
            return StoreCommitResult.Accepted(sample, cost)
        } finally {
            db.endTransaction()
        }
    }

    override fun replaceState(state: PersistedEnergyState) {
        val db = helper.writableDatabase
        db.beginTransaction()
        try {
            db.delete("energy_intervals", null, null)
            db.delete("meter_cursors", null, null)
            db.delete("cost_entries", null, null)
            db.delete("budget_periods", null, null)
            for (sample in state.entries) {
                val values = ContentValues().apply {
                    put("sampleId", sample.sampleId)
                    put("source", sample.source)
                    put("scope", sample.scope.wire())
                    put("quality", sample.quality.name)
                    put("unit", sample.unit)
                    if (sample.value == null) putNull("value") else put("value", sample.value)
                    if (sample.wattHours == null) putNull("wattHours") else put("wattHours", sample.wattHours)
                    put("startMs", sample.startMs)
                    put("endMs", sample.endMs)
                    put("startUTC", sample.utcMs)
                    put("endUTC", sample.utcMs)
                    put("startMono", sample.monotonicMs)
                    put("endMono", sample.monotonicMs)
                    put("meterEpoch", sample.meterEpoch)
                    put("sessionId", sample.sessionId)
                    put("unknownReason", sample.unknownReason)
                }
                db.insertOrThrow("energy_intervals", null, values)
            }
            for (cost in state.costs) {
                val costCv = ContentValues().apply {
                    put("intervalSampleId", cost.intervalSampleId)
                    put("tariffVersion", cost.tariffVersion)
                    put("amountExact", cost.amountExact)
                    put("currency", cost.currency)
                    put("quality", cost.quality)
                }
                db.insertOrThrow("cost_entries", null, costCv)
            }
            for (cursor in state.cursors) {
                val cv = ContentValues().apply {
                    put("sourceId", cursor.sourceId)
                    put("epoch", cursor.epoch)
                    put("counterWh", cursor.counterWh)
                    put("lastTimestampMs", cursor.lastTimestampMs)
                }
                db.insertOrThrow("meter_cursors", null, cv)
            }
            state.budget?.let { budget ->
                val bCv = ContentValues().apply {
                    put("id", budget.id)
                    put("zoneId", budget.zoneId)
                    put("periodStartMs", budget.periodStartMs)
                    put("usedExact", budget.usedExact)
                    put("reservedExact", budget.reservedExact)
                    put("revision", budget.revision)
                }
                db.insertOrThrow("budget_periods", null, bCv)
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    private class Helper(context: Context, name: String) :
        SQLiteOpenHelper(context, name, null, VERSION) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL(
                """CREATE TABLE energy_intervals (
                    sampleId TEXT PRIMARY KEY NOT NULL,
                    source TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    quality TEXT NOT NULL,
                    unit TEXT,
                    value REAL,
                    wattHours REAL,
                    startMs INTEGER NOT NULL,
                    endMs INTEGER NOT NULL,
                    startUTC INTEGER,
                    endUTC INTEGER,
                    startMono INTEGER,
                    endMono INTEGER,
                    meterEpoch TEXT,
                    sessionId TEXT,
                    unknownReason TEXT
                )"""
            )
            db.execSQL(
                """CREATE TABLE meter_cursors (
                    sourceId TEXT PRIMARY KEY NOT NULL,
                    epoch TEXT NOT NULL,
                    counterWh REAL NOT NULL,
                    lastTimestampMs INTEGER NOT NULL
                )"""
            )
            db.execSQL(
                """CREATE TABLE cost_entries (
                    intervalSampleId TEXT NOT NULL,
                    tariffVersion TEXT NOT NULL,
                    amountExact TEXT NOT NULL,
                    currency TEXT NOT NULL,
                    quality TEXT NOT NULL,
                    PRIMARY KEY(intervalSampleId, tariffVersion)
                )"""
            )
            db.execSQL(
                """CREATE TABLE budget_periods (
                    id TEXT PRIMARY KEY NOT NULL,
                    zoneId TEXT NOT NULL,
                    periodStartMs INTEGER NOT NULL,
                    usedExact TEXT NOT NULL,
                    reservedExact TEXT NOT NULL,
                    revision INTEGER NOT NULL
                )"""
            )
        }

        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
            // v1 only — wipe on future schema bumps until migrations are designed.
            db.execSQL("DROP TABLE IF EXISTS energy_intervals")
            db.execSQL("DROP TABLE IF EXISTS meter_cursors")
            db.execSQL("DROP TABLE IF EXISTS cost_entries")
            db.execSQL("DROP TABLE IF EXISTS budget_periods")
            onCreate(db)
        }
    }

    companion object {
        private const val VERSION = 1
    }
}
