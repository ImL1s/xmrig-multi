package com.iml1s.xmrigminer.data.profile

import com.iml1s.xmrigminer.data.model.MiningConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MiningProfileMapperTest {

    @Test
    fun `manual MiningConfig maps to manual profile fields`() {
        val config = MiningConfig(
            poolUrl = "pool.supportxmr.com:3333",
            walletAddress = "44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXft3XjrpDtQGv7SqSsaBYBb98uNbr2VBBEt7f2wfn3RVGQBEP3A",
            workerName = "android",
            threads = 3,
            threadsAuto = false,
            maxCpuUsage = 75,
            useTls = true,
            donateLevel = 1
        )
        val profile = MiningProfileMapper.fromMiningConfig(config, id = "t1")
        assertEquals(1, profile.schemaVersion)
        assertEquals("manual", profile.cpu.mode)
        assertEquals(3, profile.cpu.threads)
        assertNull(profile.cpu.maxThreadsHintPercent)
        assertEquals("stratum", profile.endpoint.type)
        assertEquals(true, profile.endpoint.tls)
        assertEquals("XMR", profile.payoutAsset)

        val roundTrip = MiningProfileMapper.toMiningConfig(profile)
        assertEquals(config.poolUrl, roundTrip.poolUrl)
        assertEquals(config.walletAddress, roundTrip.walletAddress)
        assertEquals(config.threads, roundTrip.threads)
        assertEquals(false, roundTrip.threadsAuto)
        assertEquals(true, roundTrip.useTls)
    }

    @Test
    fun `auto MiningConfig does not put threads into profile threads`() {
        val config = MiningConfig(
            threadsAuto = true,
            threads = 8,
            maxCpuUsage = 60,
            walletAddress = "8AfUwcnoJiRDMXnDGj3zX6bMgfaj9pM1WFGr2pakLm3jSYXVLD5fcDMBzkmk4AeSqWYQTA5aerXJ43W65AT82RMqG6NDBnC",
            poolUrl = "gulf.moneroocean.stream:10128"
        )
        val profile = MiningProfileMapper.fromMiningConfig(config)
        assertEquals("auto", profile.cpu.mode)
        assertNull(profile.cpu.threads)
        assertEquals(60, profile.cpu.maxThreadsHintPercent)

        val back = MiningProfileMapper.toMiningConfig(profile)
        assertEquals(true, back.threadsAuto)
        assertEquals(60, back.maxCpuUsage)
    }

    @Test
    fun `solo daemon maps to endpoint type daemon`() {
        val config = MiningConfig(
            soloDaemon = true,
            poolUrl = MiningConfig.DEFAULT_SOLO_DAEMON_URL,
            walletAddress = "44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXft3XjrpDtQGv7SqSsaBYBb98uNbr2VBBEt7f2wfn3RVGQBEP3A"
        )
        val profile = MiningProfileMapper.fromMiningConfig(config)
        assertEquals("daemon", profile.endpoint.type)
        assertTrue(MiningProfileMapper.toMiningConfig(profile).soloDaemon)
    }

    @Test
    fun `public field mapping table covers MiningConfig surface`() {
        val expected = mapOf(
            "poolUrl" to "endpoint.url",
            "walletAddress" to "account.user",
            "workerName" to "account.pass",
            "threads" to "cpu.threads",
            "threadsAuto" to "cpu.mode",
            "maxCpuUsage" to "cpu.maxThreadsHintPercent",
            "useTls" to "endpoint.tls",
            "autoReconnect" to "network.autoReconnect",
            "donateLevel" to "donateLevel",
            "coinType" to "coin",
            "soloDaemon" to "endpoint.type"
        )
        // Sanity: every documented mapping key exists on MiningConfig
        val names = MiningConfig::class.java.declaredFields.map { it.name }.toSet()
        expected.keys.forEach { key ->
            assertTrue("MiningConfig missing $key", names.contains(key))
        }
        assertEquals(11, expected.size)
    }
}
