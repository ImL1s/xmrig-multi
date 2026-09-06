package com.iml1s.xmrigminer.data.economy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EconomySnapshotTest {

    @Test
    fun `paid not double counted with credited`() {
        val s = EconomySnapshotBuilder.build(
            credited = 8.0,
            paid = 3.0,
            marketRate = 100.0,
            energyCostFiat = 50.0
        )
        assertEquals("credited", s.valueLayer)
        assertEquals(8.0, s.netNative!!, 1e-9)
        assertEquals(5.0, s.unpaid!!, 1e-9)
        assertEquals(750.0, s.netFiat!!, 1e-9)
    }

    @Test
    fun `unknown revenue does not invent profit`() {
        val s = EconomySnapshotBuilder.build(energyCostFiat = 12.0, marketRate = 100.0)
        assertNull(s.netFiat)
        assertEquals("unknown", s.netQuality)
        assertNull(s.profitable)
    }

    @Test
    fun `shared wallet counted once`() {
        val (total, wallets) = EconomySnapshotBuilder.dedupeWalletBalances(
            listOf("w1" to 5.0, "w1" to 5.0, "w2" to 3.0)
        )
        assertEquals(8.0, total, 1e-9)
        assertEquals(2, wallets)
    }

    @Test
    fun `csvSafe blocks formula injection`() {
        assertEquals("'=cmd", EconomySnapshotBuilder.csvSafe("=cmd"))
    }
}
