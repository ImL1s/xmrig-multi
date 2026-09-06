package com.iml1s.xmrigminer.data.energy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EnergyLedgerTest {

    private val t0 = 1_725_000_000_000L
    private val hour = 3_600_000L

    @Test
    fun `100W times 10h equals 1 kWh`() {
        val ledger = EnergyLedger()
        val r = ledger.commitRaw(
            source = "manual",
            scopeWire = "manual",
            quality = EnergyQuality.MANUAL,
            unit = "W",
            value = 100.0,
            startMs = t0,
            endMs = t0 + 10 * hour
        )
        assertTrue(r.accepted)
        assertEquals(1000.0, ledger.snapshot().deviceWh!!, 1e-9)
    }

    @Test
    fun `clock vs mine incremental golden 30 days`() {
        val duration = 30L * 10 * hour
        val deviceWh = EnergyUnits.integrateWatts(8.0, duration)!!
        val baselineWh = EnergyUnits.integrateWatts(3.0, duration)!!
        assertEquals(2400.0, deviceWh, 1e-6)
        assertEquals(900.0, baselineWh, 1e-6)
        val cal = calibrateIncremental(deviceWh, baselineWh, BaselineMode.CLOCK)
        assertEquals(1500.0, cal.incrementalWh!!, 1e-6)
    }

    @Test
    fun `unknown quality does not yield zero deviceWh`() {
        val ledger = EnergyLedger()
        ledger.commit(
            EnergySample(
                sampleId = "u1",
                source = "sensor",
                scope = EnergyScope.WALL,
                quality = EnergyQuality.UNKNOWN,
                unit = "W",
                value = null,
                wattHours = null,
                startMs = t0,
                endMs = t0 + hour,
                unknownReason = "missing"
            )
        )
        val snap = ledger.snapshot()
        assertNull(snap.deviceWh)
        assertEquals(EnergyQuality.UNKNOWN, snap.deviceQuality)
        assertTrue(snap.unknownCoverageMs > 0)
    }

    @Test
    fun `counter reset is unknown not free energy`() {
        val ledger = EnergyLedger()
        ledger.commitCumulative(source = "shelly", value = 100.0, endMs = t0, meterEpoch = "e1")
        ledger.commitCumulative(source = "shelly", value = 150.0, endMs = t0 + hour, meterEpoch = "e1")
        assertEquals(50.0, ledger.snapshot().deviceWh!!, 1e-9)
        val reset = ledger.commitCumulative(
            source = "shelly",
            value = 5.0,
            endMs = t0 + 2 * hour,
            meterEpoch = "e1"
        )
        assertTrue(reset.accepted)
        assertEquals(EnergyQuality.UNKNOWN, reset.entry!!.quality)
        assertEquals("counter-reset", reset.entry!!.unknownReason)
    }

    @Test
    fun `duplicate sampleId not double billed`() {
        val ledger = EnergyLedger()
        val s = EnergySample(
            sampleId = "dup",
            source = "manual",
            scope = EnergyScope.MANUAL,
            quality = EnergyQuality.MANUAL,
            unit = "Wh",
            value = 10.0,
            wattHours = 10.0,
            startMs = t0,
            endMs = t0 + hour
        )
        assertTrue(ledger.commit(s).accepted)
        assertEquals(false, ledger.commit(s).accepted)
        assertEquals(10.0, ledger.snapshot().deviceWh!!, 1e-9)
        val again = EnergyLedger.fromEntries(ledger.exportRange(t0, t0 + hour))
        assertEquals(10.0, again.snapshot().deviceWh!!, 1e-9)
    }

    @Test
    fun `shared meter counted once`() {
        val a = attributeSharedMeter(1000.0, listOf("m1", "m2"), "shared_total")
        assertEquals(1000.0, a.totalWh!!, 1e-9)
        assertTrue(a.perMiner.isEmpty())
    }

    @Test
    fun `baseline off does not deduct standby`() {
        val cal = calibrateIncremental(500.0, 100.0, BaselineMode.OFF)
        assertEquals(500.0, cal.incrementalWh!!, 1e-9)
        assertEquals(0.0, cal.baselineWh!!, 1e-9)
    }

    @Test
    fun `manual repository records watts interval`() {
        val repo = EnergyRepository()
        assertEquals(false, repo.commitManualInterval(t0, t0 + hour).accepted)
        repo.setManualWatts(50.0)
        assertTrue(repo.commitManualInterval(t0, t0 + hour, "m1").accepted)
        assertEquals(50.0, repo.snapshot().deviceWh!!, 1e-9)
    }
}
