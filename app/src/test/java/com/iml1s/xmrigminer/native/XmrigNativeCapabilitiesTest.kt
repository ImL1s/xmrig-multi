package com.iml1s.xmrigminer.native

import com.iml1s.xmrigminer.data.model.CoinType
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class XmrigNativeCapabilitiesTest {

    @Test
    fun `packaged Android XMRig is built without TLS`() {
        assertFalse(XmrigNativeCapabilities.TLS_ENABLED)
        assertTrue(XmrigNativeCapabilities.TLS_UNSUPPORTED_MESSAGE.contains("TLS"))
    }

    @Test
    fun `Monero start is allowed`() {
        assertNull(XmrigNativeCapabilities.assertStartAllowed(CoinType.MONERO))
    }

    @Test
    fun `WOW and DERO start are blocked until verified adapters exist`() {
        assertNotNull(XmrigNativeCapabilities.assertStartAllowed(CoinType.WOWNERO))
        assertNotNull(XmrigNativeCapabilities.assertStartAllowed(CoinType.DERO))
        assertTrue(
            XmrigNativeCapabilities.assertStartAllowed(CoinType.DERO)!!.contains("#27")
        )
        assertTrue(
            XmrigNativeCapabilities.assertStartAllowed(CoinType.WOWNERO)!!.contains("#28")
        )
    }

    @Test
    fun `MoneroOcean rejects WOW coin pairing`() {
        val err = XmrigNativeCapabilities.assertMoneroOceanPayout(
            "gulf.moneroocean.stream:10128",
            CoinType.WOWNERO,
            "Wo" + "a".repeat(95)
        )
        assertNotNull(err)
        assertTrue(err!!.contains("#29"))
    }

    @Test
    fun `MoneroOcean accepts Monero address`() {
        assertNull(
            XmrigNativeCapabilities.assertMoneroOceanPayout(
                "MoneroOcean",
                CoinType.MONERO,
                "4" + "A".repeat(94)
            )
        )
    }
}
