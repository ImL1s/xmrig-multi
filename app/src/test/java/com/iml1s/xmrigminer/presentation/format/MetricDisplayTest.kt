package com.iml1s.xmrigminer.presentation.format

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Boundary coverage for the display vocabulary required by #54 and #59: unknown values must
 * never be formatted as `0`, and "no sample yet" must be distinguishable from "no data source".
 */
class MetricDisplayTest {

    // ---- hashrate ---------------------------------------------------------

    @Test
    fun `hashrate formats SI steps`() {
        assertEquals("12.34 H/s", MetricFormat.hashrateText(12.34))
        // Avoids an exact .x5 boundary: Java rounds it half-up while JS rounds the binary
        // double down, and web/js/format.js has to produce the same string.
        assertEquals("150.5 H/s", MetricFormat.hashrateText(150.46))
        assertEquals("1.50 kH/s", MetricFormat.hashrateText(1500.0))
        assertEquals("2.50 MH/s", MetricFormat.hashrateText(2_500_000.0))
    }

    @Test
    fun `hashrate uses a dot decimal separator regardless of default locale`() {
        val previous = java.util.Locale.getDefault()
        try {
            java.util.Locale.setDefault(java.util.Locale.GERMANY)
            assertEquals("1.50 kH/s", MetricFormat.hashrateText(1500.0))
        } finally {
            java.util.Locale.setDefault(previous)
        }
    }

    @Test
    fun `hashrate while running with no sample is pending not zero`() {
        val reading = MetricFormat.hashrate(0.0, isRunning = true)
        assertEquals(MetricQuality.PENDING, reading.quality)
        assertFalse(reading.hasValue)
        assertEquals(MetricReading.PLACEHOLDER, reading.text)
    }

    @Test
    fun `hashrate while stopped is unavailable not zero`() {
        val reading = MetricFormat.hashrate(0.0, isRunning = false)
        assertEquals(MetricQuality.UNAVAILABLE, reading.quality)
        assertEquals(MetricReading.PLACEHOLDER, reading.text)
    }

    @Test
    fun `hashrate rejects NaN infinity and negatives`() {
        for (bad in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, -1.0)) {
            val reading = MetricFormat.hashrate(bad, isRunning = false)
            assertFalse("$bad should not render a value", reading.hasValue)
            assertEquals(MetricQuality.UNAVAILABLE, reading.quality)
        }
    }

    @Test
    fun `hashrate null is unavailable`() {
        assertFalse(MetricFormat.hashrate(null, isRunning = false).hasValue)
    }

    @Test
    fun `hashrate reports a real measurement`() {
        val reading = MetricFormat.hashrate(42.5, isRunning = true)
        assertTrue(reading.hasValue)
        assertEquals(MetricQuality.MEASURED, reading.quality)
        assertEquals("42.50 H/s", reading.text)
    }

    // ---- shares -----------------------------------------------------------

    @Test
    fun `success rate with no shares is unavailable not zero percent`() {
        val reading = MetricFormat.shareSuccessRate(0, 0)
        assertEquals(MetricQuality.UNAVAILABLE, reading.quality)
        assertEquals(MetricReading.PLACEHOLDER, reading.text)
    }

    @Test
    fun `success rate reports all rejected as zero percent`() {
        assertEquals("0.0%", MetricFormat.shareSuccessRate(0, 3).text)
    }

    @Test
    fun `success rate computes a partial rate`() {
        assertEquals("75.0%", MetricFormat.shareSuccessRate(3, 1).text)
        assertEquals("100.0%", MetricFormat.shareSuccessRate(5, 0).text)
    }

    @Test
    fun `share ledger always shows both counters`() {
        assertEquals("0 / 0", MetricFormat.shareLedger(0, 0).text)
        assertEquals("12 / 3", MetricFormat.shareLedger(12, 3).text)
    }

    // ---- temperature ------------------------------------------------------

    @Test
    fun `temperature without a sensor is unavailable`() {
        for (bad in listOf(0f, -5f, Float.NaN, 200f)) {
            assertFalse("$bad should not render", MetricFormat.temperature(bad).hasValue)
        }
        assertFalse(MetricFormat.temperature(null).hasValue)
    }

    @Test
    fun `temperature renders a plausible reading`() {
        assertEquals("41.5 °C", MetricFormat.temperature(41.5f).text)
    }

    // ---- CPU --------------------------------------------------------------

    @Test
    fun `process cpu is estimated and clamped`() {
        val reading = MetricFormat.processCpuPercent(37.4f, isRunning = true)
        assertEquals(MetricQuality.ESTIMATED, reading.quality)
        assertEquals("37%", reading.text)
        assertEquals("100%", MetricFormat.processCpuPercent(320f, isRunning = true).text)
    }

    @Test
    fun `process cpu distinguishes no sample from no source`() {
        assertEquals(MetricQuality.PENDING, MetricFormat.processCpuPercent(0f, true).quality)
        assertEquals(MetricQuality.UNAVAILABLE, MetricFormat.processCpuPercent(0f, false).quality)
        assertEquals(MetricQuality.UNAVAILABLE, MetricFormat.processCpuPercent(-1f, false).quality)
    }

    // ---- battery / difficulty / uptime ------------------------------------

    @Test
    fun `battery rejects out of range levels`() {
        assertFalse(MetricFormat.battery(-1).hasValue)
        assertFalse(MetricFormat.battery(101).hasValue)
        assertFalse(MetricFormat.battery(null).hasValue)
        assertEquals("0%", MetricFormat.battery(0).text)
        assertEquals("100%", MetricFormat.battery(100).text)
    }

    @Test
    fun `difficulty groups digits and treats zero as no job yet`() {
        assertFalse(MetricFormat.difficulty(0L).hasValue)
        assertFalse(MetricFormat.difficulty(null).hasValue)
        assertEquals("120 001", MetricFormat.difficulty(120_001L).text)
        assertEquals("999", MetricFormat.difficulty(999L).text)
        assertEquals("9 223 372 036 854 775 807", MetricFormat.difficulty(Long.MAX_VALUE).text)
    }

    @Test
    fun `uptime pads minutes and seconds and grows past a day`() {
        assertEquals("0:00:00", MetricFormat.uptime(0L).text)
        assertEquals("0:01:05", MetricFormat.uptime(65L).text)
        assertEquals("25:00:01", MetricFormat.uptime(90_001L).text)
        assertFalse(MetricFormat.uptime(-1L).hasValue)
    }

    // ---- threads (#31) ----------------------------------------------------

    @Test
    fun `thread request reads as requested over available`() {
        assertEquals("3 / 8", MetricFormat.threadRequest(3, 8).text)
    }

    @Test
    fun `thread request rejects zero which was the single core default`() {
        assertFalse(MetricFormat.threadRequest(0, 1).hasValue)
        assertFalse(MetricFormat.threadRequest(2, 0).hasValue)
        assertFalse(MetricFormat.threadRequest(null, 4).hasValue)
    }
}
