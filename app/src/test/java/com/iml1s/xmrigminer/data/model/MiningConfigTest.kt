package com.iml1s.xmrigminer.data.model

import com.iml1s.xmrigminer.data.repository.ConfigRepositoryDefaults
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test

class MiningConfigTest {

    @Test
    fun `isValid returns true for valid config`() {
        val config = MiningConfig(
            poolUrl = "pool.supportxmr.com:3333",
            walletAddress = "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge",
            workerName = "android",
            threads = 4,
            maxCpuUsage = 75
        )
        assertTrue(config.isValid())
    }

    @Test
    fun `isValid returns false when wallet is empty`() {
        val config = MiningConfig(
            poolUrl = "pool.supportxmr.com:3333",
            walletAddress = "",
            threads = 4,
            maxCpuUsage = 75
        )
        assertFalse(config.isValid())
    }

    @Test
    fun `isValid returns false when pool is empty`() {
        val config = MiningConfig(
            poolUrl = "",
            walletAddress = "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge",
            threads = 4,
            maxCpuUsage = 75
        )
        assertFalse(config.isValid())
    }

    @Test
    fun `isValid returns false when threads is zero or negative`() {
        val config = MiningConfig(
            poolUrl = "pool.supportxmr.com:3333",
            walletAddress = "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge",
            threads = 0,
            maxCpuUsage = 75
        )
        assertFalse(config.isValid())
    }

    @Test
    fun `isValid returns false when maxCpuUsage is out of range`() {
        val configLow = MiningConfig(
            poolUrl = "pool.supportxmr.com:3333",
            walletAddress = "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge",
            threads = 4,
            maxCpuUsage = 5
        )
        val configHigh = MiningConfig(
            poolUrl = "pool.supportxmr.com:3333",
            walletAddress = "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge",
            threads = 4,
            maxCpuUsage = 150
        )
        assertFalse(configLow.isValid())
        assertFalse(configHigh.isValid())
    }

    @Test
    fun `toJson contains pool url`() {
        val config = MiningConfig(
            poolUrl = "gulf.moneroocean.stream:10128",
            walletAddress = "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge",
            threads = 4
        )
        val json = config.toJson()
        assertTrue(json.contains("gulf.moneroocean.stream:10128"))
    }

    @Test
    fun `toJson contains wallet address`() {
        val config = MiningConfig(
            poolUrl = "pool.supportxmr.com:3333",
            walletAddress = "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge",
            threads = 4
        )
        val json = config.toJson()
        assertTrue(json.contains("4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge"))
    }

    @Test
    fun `default config has valid threads`() {
        val config = MiningConfig()
        assertTrue(config.threads > 0)
    }

    @Test
    fun `defaultThreads never zero across CPU counts`() {
        for (n in listOf(1, 2, 4, 8, 64)) {
            val t = MiningConfig.defaultThreads(n)
            assertTrue("n=$n -> $t", t in 1..n)
        }
        assertEquals(1, MiningConfig.defaultThreads(1))
        assertEquals(1, MiningConfig.defaultThreads(0))
        assertEquals(7, MiningConfig.defaultThreads(8))
    }

    @Test
    fun `auto mode omits max-threads-hint conflict when manual`() {
        val manual = MiningConfig(
            poolUrl = "pool.supportxmr.com:3333",
            walletAddress = "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge",
            threads = 4,
            threadsAuto = false,
            maxCpuUsage = 75
        )
        val cpu = Json.parseToJsonElement(manual.toJson()).jsonObject["cpu"]!!.jsonObject
        assertNull(cpu["max-threads-hint"])
    }

    @Test
    fun `auto mode writes max-threads-hint and stays valid with any threads field`() {
        val auto = MiningConfig(
            poolUrl = "pool.supportxmr.com:3333",
            walletAddress = "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge",
            threads = 0,
            threadsAuto = true,
            maxCpuUsage = 50
        )
        assertTrue(auto.isValid())
        val cpu = Json.parseToJsonElement(auto.toJson()).jsonObject["cpu"]!!.jsonObject
        assertEquals(50, cpu["max-threads-hint"]!!.jsonPrimitive.int)
    }

    @Test
    fun `default wallet is empty so first launch cannot mine to the fee address`() {
        val config = MiningConfig()
        assertEquals("", config.walletAddress)
        assertFalse(config.isValid())
    }

    @Test
    fun `toJson uses configured donate level and log file`() {
        val config = MiningConfig(
            poolUrl = "pool.supportxmr.com:3333",
            walletAddress = "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge",
            donateLevel = 1
        )
        val json = config.toJson("/data/xmrig.log")
        assertTrue(json.contains("\"donate-level\": 1"))
        assertTrue(json.contains("/data/xmrig.log"))
        assertTrue(json.contains("4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge"))
    }

    @Test
    fun `toJson escapes quotes in worker name`() {
        val config = MiningConfig(
            poolUrl = "pool.supportxmr.com:3333",
            walletAddress = "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge",
            workerName = "my\"rig",
            threads = 4
        )
        val parsed = Json.parseToJsonElement(config.toJson())
            .jsonObject["pools"]!!.jsonArray[0].jsonObject
        assertEquals("my\"rig", parsed["pass"]!!.jsonPrimitive.content)
    }

    @Test
    fun `default tls is off so plaintext pool ports work`() {
        val config = MiningConfig()
        assertFalse(config.useTls)
    }

    @Test
    fun `fresh-install MoneroOcean port is written without TLS`() {
        val config = MiningConfig(
            poolUrl = ConfigRepositoryDefaults.POOL_URL,
            walletAddress = "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge",
            useTls = ConfigRepositoryDefaults.USE_TLS
        )
        val pool = Json.parseToJsonElement(config.toJson())
            .jsonObject["pools"]!!.jsonArray[0].jsonObject
        assertEquals("gulf.moneroocean.stream:10128", pool["url"]!!.jsonPrimitive.content)
        assertFalse(pool["tls"]!!.jsonPrimitive.boolean)
        assertNull(pool["daemon"])
        assertTrue(pool["keepalive"]!!.jsonPrimitive.boolean)
    }

    @Test
    fun `solo daemon JSON uses daemon true keepalive false and monero coin`() {
        val config = MiningConfig(
            poolUrl = "192.168.1.10:18081",
            walletAddress = "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge",
            workerName = "android",
            soloDaemon = true,
            useTls = true, // must be forced off in JSON
            coinType = "MONERO"
        )
        val pool = Json.parseToJsonElement(config.toJson())
            .jsonObject["pools"]!!.jsonArray[0].jsonObject
        assertEquals("192.168.1.10:18081", pool["url"]!!.jsonPrimitive.content)
        assertEquals(
            "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge",
            pool["user"]!!.jsonPrimitive.content
        )
        assertEquals("x", pool["pass"]!!.jsonPrimitive.content)
        assertEquals("monero", pool["coin"]!!.jsonPrimitive.content)
        assertTrue(pool["daemon"]!!.jsonPrimitive.boolean)
        assertFalse(pool["keepalive"]!!.jsonPrimitive.boolean)
        assertFalse(pool["tls"]!!.jsonPrimitive.boolean)
    }

    @Test
    fun `soloDaemon invalid when coin is not Monero`() {
        val config = MiningConfig(
            poolUrl = MiningConfig.DEFAULT_SOLO_DAEMON_URL,
            walletAddress = "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge",
            soloDaemon = true,
            coinType = "WOWNERO"
        )
        assertFalse(config.isValid())
    }

    @Test
    fun `pool mode JSON does not include daemon field`() {
        val config = MiningConfig(
            poolUrl = "pool.supportxmr.com:3333",
            walletAddress = "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge",
            soloDaemon = false
        )
        val pool = Json.parseToJsonElement(config.toJson())
            .jsonObject["pools"]!!.jsonArray[0].jsonObject
        assertNull(pool["daemon"])
        assertTrue(pool["keepalive"]!!.jsonPrimitive.boolean)
    }

    @Test
    fun `toJson writes resolved randomx mode from memory budget`() {
        val lowRam = MiningConfig(
            poolUrl = "pool.supportxmr.com:3333",
            walletAddress = "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge",
            randomxMode = "auto",
            threads = 2
        )
        val rx = Json.parseToJsonElement(
            lowRam.toJson(availableMemoryBytes = 1_500_000_000L, totalMemoryBytes = 2_000_000_000L)
        ).jsonObject["randomx"]!!.jsonObject
        assertEquals("light", rx["mode"]!!.jsonPrimitive.content)

        val light = MiningConfig(
            poolUrl = "pool.supportxmr.com:3333",
            walletAddress = "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge",
            randomxMode = "light"
        )
        val rx2 = Json.parseToJsonElement(light.toJson()).jsonObject["randomx"]!!.jsonObject
        assertEquals("light", rx2["mode"]!!.jsonPrimitive.content)
    }

    @Test
    fun `autoReconnect false writes zero XMRig retries`() {
        val config = MiningConfig(
            poolUrl = "pool.supportxmr.com:3333",
            walletAddress = "4AdUndXHHZ6cfufTMvppY6JwXNouMBzSkbLYfpAV5Usx3skxNgYeYTRj5UzqtReoS44qo9mtmXCqY45DJ852K5Jv2684Rge",
            autoReconnect = false,
            retries = 5
        )
        val root = Json.parseToJsonElement(config.toJson()).jsonObject
        assertEquals(0, root["retries"]!!.jsonPrimitive.int)

        val on = config.copy(autoReconnect = true)
        val rootOn = Json.parseToJsonElement(on.toJson()).jsonObject
        assertEquals(5, rootOn["retries"]!!.jsonPrimitive.int)
    }
}
