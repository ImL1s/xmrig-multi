package com.iml1s.xmrigminer.native

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class XmrigNativeCapabilitiesTest {

    @Test
    fun `packaged Android XMRig is built without TLS`() {
        assertFalse(XmrigNativeCapabilities.TLS_ENABLED)
        assertTrue(XmrigNativeCapabilities.TLS_UNSUPPORTED_MESSAGE.contains("TLS"))
    }
}
