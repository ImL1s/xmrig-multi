package com.iml1s.xmrigminer.data.energy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ElectricityTariffTest {

    private val demoTiers = listOf(
        ElectricityTariff.Tier(100.0, 2.0),
        ElectricityTariff.Tier(200.0, 4.0),
        ElectricityTariff.Tier(Double.POSITIVE_INFINITY, 7.0)
    )

    @Test
    fun `unknown fixed rate is not zero`() {
        val r = ElectricityTariffCalculator.billFixed(10.0, null)
        assertFalse(r.ok)
        assertEquals("unknown-rate", r.reason)
    }

    @Test
    fun `progressive marginal home 95 plus 10 is 30`() {
        val m = ElectricityTariffCalculator.marginalProgressive(95.0, 10.0, demoTiers)
        assertTrue(m.ok)
        assertEquals(30.0, m.amount!!, 1e-9)
    }

    @Test
    fun `progressive marginal home 195 plus 10 is 55`() {
        val m = ElectricityTariffCalculator.marginalProgressive(195.0, 10.0, demoTiers)
        assertTrue(m.ok)
        assertEquals(55.0, m.amount!!, 1e-9)
    }

    @Test
    fun `progressive does not bill all at top tier`() {
        val b = ElectricityTariffCalculator.billProgressive(150.0, demoTiers)
        assertEquals(400.0, b.amount!!, 1e-9)
    }

    @Test
    fun `explicit zero rate allowed`() {
        assertEquals(0.0, ElectricityTariffCalculator.billFixed(3.0, 0.0).amount!!, 1e-9)
    }
}
