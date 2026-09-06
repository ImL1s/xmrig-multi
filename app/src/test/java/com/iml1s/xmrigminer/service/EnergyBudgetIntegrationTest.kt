package com.iml1s.xmrigminer.service

import com.iml1s.xmrigminer.data.energy.EnergyLedgerStore
import com.iml1s.xmrigminer.data.energy.EnergyQuality
import com.iml1s.xmrigminer.data.energy.EnergySample
import com.iml1s.xmrigminer.data.energy.EnergyScope
import com.iml1s.xmrigminer.data.energy.MemoryEnergyLedgerStore
import com.iml1s.xmrigminer.data.energy.StoreCommitResult
import com.iml1s.xmrigminer.data.model.MiningConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Consumer path: UI settings → persist → meter → budget stop (#130).
 * Removing [EnergyBudgetActuator.apply] pause or meter commit must fail these tests.
 */
class EnergyBudgetIntegrationTest {

    private val hour = 3_600_000L
    private val t0 = 1_725_000_000_000L

    @Test
    fun `manual 50W for 2h at 5 per kWh equals 0_1 kWh and 0_5 fiat`() {
        val (kwh, fiat) = EnergySessionMeter.manualCostExample(50.0, 2 * hour, 5.0)
        assertEquals(0.1, kwh, 1e-12)
        assertEquals(0.5, fiat, 1e-12)
    }

    @Test
    fun `fake session meters cost with manual quality label`() {
        val store = MemoryEnergyLedgerStore()
        val meter = EnergySessionMeter(store)
        var now = t0
        meter.setClock { now }
        val config = MiningConfig(
            manualWatts = 50.0,
            electricityRatePerKwh = 5.0,
            electricityCurrency = "TWD"
        )
        meter.onSessionStart("s1", now)
        now += 2 * hour
        val tick = meter.tick(config, nowMs = now, flush = true)
        assertTrue(tick.committed)
        assertEquals(0.1, tick.summary!!.kwh!!, 1e-9)
        assertEquals(0.5, tick.summary!!.fiat!!, 1e-9)
        assertEquals("manual", tick.summary!!.quality)
        assertTrue(tick.summary!!.sourceLabel.contains("50"))
    }

    @Test
    fun `relaunch replay of same sample is duplicate no-op not double count`() {
        val store = MemoryEnergyLedgerStore()
        val meter = EnergySessionMeter(store)
        val sample = EnergySample(
            sampleId = "manual:s1:$t0:${t0 + hour}",
            source = "user-manual",
            scope = EnergyScope.MANUAL,
            quality = EnergyQuality.MANUAL,
            unit = "W",
            value = 50.0,
            wattHours = 50.0,
            startMs = t0,
            endMs = t0 + hour,
            sessionId = "s1"
        )
        assertTrue(meter.replaySample(sample) is StoreCommitResult.Accepted)
        assertTrue(meter.replaySample(sample) is StoreCommitResult.DuplicateNoOp)

        // Simulate process relaunch: new meter from same store.
        val relaunched = EnergySessionMeter(store)
        assertTrue(relaunched.replaySample(sample) is StoreCommitResult.DuplicateNoOp)
        assertEquals(0.05, relaunched.kwhInRange(t0, t0 + hour)!!, 1e-9)
    }

    @Test
    fun `conflicting replay with same id is rejected`() {
        val store = MemoryEnergyLedgerStore()
        val meter = EnergySessionMeter(store)
        val a = EnergySample(
            sampleId = "id1",
            source = "user-manual",
            scope = EnergyScope.MANUAL,
            quality = EnergyQuality.MANUAL,
            unit = "W",
            value = 50.0,
            wattHours = 50.0,
            startMs = t0,
            endMs = t0 + hour
        )
        val b = a.copy(value = 80.0, wattHours = 80.0)
        assertTrue(meter.replaySample(a) is StoreCommitResult.Accepted)
        assertTrue(meter.replaySample(b) is StoreCommitResult.Rejected)
    }

    @Test
    fun `low daily spend cap with fake clock stops miner via actuator spy`() {
        val store = MemoryEnergyLedgerStore()
        val meter = EnergySessionMeter(store)
        var now = t0
        meter.setClock { now }
        // Cap 0.01 TWD; 50W @ 5/kWh burns ~0.000694 TWD per 5s sample → reserve exceeds quickly.
        val config = MiningConfig(
            manualWatts = 50.0,
            electricityRatePerKwh = 5.0,
            dailySpendCapFiat = 0.01
        )
        meter.onSessionStart("budget-s", now)
        // Advance 2 hours so spent ~0.5 >> 0.01
        now += 2 * hour
        val tick = meter.tick(config, nowMs = now, flush = true)
        assertTrue(tick.committed)
        val verdict = tick.budgetVerdict!!
        assertEquals(AutomationPolicy.Kind.PAUSED, verdict.kind)

        var pauseCount = 0
        var pauseReason: String? = null
        val outcome = EnergyBudgetActuator.apply(verdict) { reason ->
            pauseCount++
            pauseReason = reason
        }
        assertTrue(outcome.pauseInvoked)
        assertEquals(1, pauseCount)
        assertNotNull(pauseReason)
        assertTrue(pauseReason!!.contains("Daily spend cap") || pauseReason!!.contains("cap"))
    }

    @Test
    fun `start gate blocks when daily kWh cap already reached`() {
        val store = MemoryEnergyLedgerStore()
        val meter = EnergySessionMeter(store)
        val config = MiningConfig(
            manualWatts = 100.0,
            electricityRatePerKwh = 5.0,
            dailyKwhCap = 0.05
        )
        // Seed 0.1 kWh already today.
        meter.replaySample(
            EnergySample(
                sampleId = "seed",
                source = "user-manual",
                scope = EnergyScope.MANUAL,
                quality = EnergyQuality.MANUAL,
                unit = "Wh",
                value = 100.0,
                wattHours = 100.0,
                startMs = t0,
                endMs = t0 + 1000
            )
        )
        val verdict = meter.evaluateBudget(config, null, nowMs = t0 + 2000)
        assertEquals(AutomationPolicy.Kind.PAUSED, verdict.kind)
        assertNotNull(EnergyBudgetActuator.startBlockReason(verdict))
    }

    @Test
    fun `userStop kind from policy is not revived by budget reset`() {
        val intent = AutomationPolicy.latchUserStop(AutomationPolicy.Intent(automationArmed = true))
        val verdict = AutomationPolicy.evaluate(
            intent = intent,
            config = AutomationPolicy.Defaults(dailySpendCapFiat = 1.0),
            budget = AutomationPolicy.Budget(spentFiatToday = 0.0),
            manualStart = true
        )
        assertEquals(AutomationPolicy.Kind.USER_STOPPED, verdict.kind)
        var paused = false
        EnergyBudgetActuator.apply(verdict) { paused = true }
        assertTrue(paused)
    }

    @Test
    fun `deleting actuator wiring would leave pauseInvoked false — spy contract`() {
        // Documents the required consumer: tests must call EnergyBudgetActuator.apply.
        val verdict = AutomationPolicy.Verdict(
            kind = AutomationPolicy.Kind.PAUSED,
            reasons = listOf("Daily spend cap reached (spent 1.0)"),
            suggestedAction = AutomationPolicy.Action.PAUSE,
            nextIntent = AutomationPolicy.Intent()
        )
        val outcome = EnergyBudgetActuator.apply(verdict) { /* spy */ }
        assertTrue(
            "Consumer must invoke pauseMiner when budget pauses",
            outcome.pauseInvoked
        )
        assertFalse(
            EnergyBudgetActuator.apply(
                verdict.copy(kind = AutomationPolicy.Kind.ALLOWED, suggestedAction = AutomationPolicy.Action.NONE)
            ) { error("must not pause") }.pauseInvoked
        )
    }

    @Test
    fun `memory store reopen preserves entries for cost recompute`() {
        val store: EnergyLedgerStore = MemoryEnergyLedgerStore()
        val meter = EnergySessionMeter(store)
        var now = t0
        meter.setClock { now }
        val config = MiningConfig(manualWatts = 50.0, electricityRatePerKwh = 5.0)
        meter.onSessionStart("persist", now)
        now += 2 * hour
        meter.tick(config, nowMs = now, flush = true)

        val reopened = EnergySessionMeter(store)
        val summary = reopened.costSummary(config, now)
        assertEquals(0.1, summary.kwh!!, 1e-9)
        assertEquals(0.5, summary.fiat!!, 1e-9)
    }
}
