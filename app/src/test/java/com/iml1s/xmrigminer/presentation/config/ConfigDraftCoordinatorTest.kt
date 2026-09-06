package com.iml1s.xmrigminer.presentation.config

import com.iml1s.xmrigminer.data.model.CoinType
import com.iml1s.xmrigminer.data.model.MiningConfig
import com.iml1s.xmrigminer.data.model.Pool
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConfigDraftCoordinatorTest {

    private val supportXmr = Pool(
        id = "supportxmr",
        name = "SupportXMR",
        url = "pool.supportxmr.com:3333",
        sslUrl = "pool.supportxmr.com:443",
        description = "SupportXMR",
        fee = "0.6%",
        coin = "MONERO",
        status = "supported"
    )
    private val moneroOcean = Pool(
        id = "moneroocean",
        name = "MoneroOcean",
        url = "gulf.moneroocean.stream:10128",
        sslUrl = "gulf.moneroocean.stream:20128",
        description = "MoneroOcean",
        fee = "0%",
        coin = "MONERO",
        status = "supported"
    )
    private val heroWow = Pool(
        id = "herominers-wow",
        name = "HeroMiners WOW",
        url = "wownero.herominers.com:10661",
        sslUrl = "wownero.herominers.com:10661",
        description = "unavailable",
        fee = "?",
        coin = "WOWNERO",
        status = "unavailable"
    )

    private fun coordinator() = ConfigDraftCoordinator {
        listOf(supportXmr, moneroOcean, heroWow)
    }

    private val xmrWallet = "4" + "A".repeat(94)
    private val wowWallet = "Wo" + "B".repeat(94)

    @Test
    fun `XMR to WOW to XMR restores original wallet and pool`() {
        val c = coordinator()
        val start = MiningConfig(
            coinType = "MONERO",
            walletAddress = xmrWallet,
            poolUrl = moneroOcean.url,
            workerName = "rig-a"
        )

        val (wow, _) = c.switchCoin(start, moneroOcean, CoinType.WOWNERO)
        assertEquals("", wow.walletAddress)
        assertEquals("WOWNERO", wow.coinType)

        val wowEdited = wow.copy(walletAddress = wowWallet, workerName = "wow-rig")
        val (back, pool) = c.switchCoin(wowEdited, null, CoinType.MONERO)

        assertEquals(xmrWallet, back.walletAddress)
        assertEquals(moneroOcean.url, back.poolUrl)
        assertEquals("rig-a", back.workerName)
        assertEquals(moneroOcean.id, pool?.id)
    }

    @Test
    fun `pool to solo to pool restores custom pool not first registry entry`() {
        val c = coordinator()
        val start = MiningConfig(
            coinType = "MONERO",
            walletAddress = xmrWallet,
            poolUrl = moneroOcean.url,
            workerName = "rig-a",
            soloDaemon = false
        )

        val (solo, soloPool) = c.toggleSolo(start, moneroOcean, enabled = true)
        assertTrue(solo.soloDaemon)
        assertEquals(null, soloPool)
        assertEquals(MiningConfig.DEFAULT_SOLO_DAEMON_URL, solo.poolUrl)

        val soloEdited = solo.copy(poolUrl = "10.0.0.5:18081")
        val (poolAgain, restoredPool) = c.toggleSolo(soloEdited, null, enabled = false)

        assertFalse(poolAgain.soloDaemon)
        assertEquals(moneroOcean.url, poolAgain.poolUrl)
        assertEquals(xmrWallet, poolAgain.walletAddress)
        assertEquals(moneroOcean.id, restoredPool?.id)
        // Must not silently fall back to SupportXMR (first in list).
        assertTrue(restoredPool?.id != supportXmr.id)
    }

    @Test
    fun `toggle solo does not keep pool URL that contains 18081`() {
        val c = coordinator()
        val sneakyPool = MiningConfig(
            coinType = "MONERO",
            walletAddress = xmrWallet,
            poolUrl = "stratum.example:18081",
            soloDaemon = false
        )
        val (solo, _) = c.toggleSolo(sneakyPool, null, enabled = true)
        assertTrue(solo.soloDaemon)
        assertEquals(MiningConfig.DEFAULT_SOLO_DAEMON_URL, solo.poolUrl)
        assertTrue(solo.poolUrl != sneakyPool.poolUrl)
    }

    @Test
    fun `custom endpoint survives coin round-trip`() {
        val c = coordinator()
        val custom = MiningConfig(
            coinType = "MONERO",
            walletAddress = xmrWallet,
            poolUrl = "custom.pool.example:4444",
            workerName = "custom-worker"
        )
        val (wow, _) = c.switchCoin(custom, null, CoinType.WOWNERO)
        val (back, pool) = c.switchCoin(wow.copy(walletAddress = wowWallet), null, CoinType.MONERO)
        assertEquals("custom.pool.example:4444", back.poolUrl)
        assertEquals(null, pool)
        assertEquals(xmrWallet, back.walletAddress)
    }
}
