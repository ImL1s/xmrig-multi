package com.iml1s.xmrigminer.data.wallet

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WalletAddressValidatorTest {

    private val official =
        "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge"

    @Test
    fun `official monero standard address validates`() {
        val r = WalletAddressValidator.validate(official, "monero")
        assertTrue(r.ok)
        assertEquals("mainnet", r.network)
        assertEquals("standard", r.addressType)
    }

    @Test
    fun `checksum mutation fails`() {
        val bad = official.replaceRange(40, 41, if (official[40] == 'A') "B" else "A")
        assertFalse(WalletAddressValidator.validate(bad, "monero").ok)
    }

    @Test
    fun `legacy 8 plus 106 fake integrated fails`() {
        val fake = "8" + "A".repeat(105)
        assertFalse(WalletAddressValidator.validate(fake, "monero").ok)
    }

    @Test
    fun `URI paste strips scheme without auto-start`() {
        val (addr, warnings) = WalletAddressValidator.parseInput("monero:$official?tx_amount=1")
        assertEquals(official, addr)
        assertTrue(warnings.any { it.contains("query", ignoreCase = true) })
    }
}
