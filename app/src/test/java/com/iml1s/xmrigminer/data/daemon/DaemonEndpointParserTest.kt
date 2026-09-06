package com.iml1s.xmrigminer.data.daemon

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DaemonEndpointParserTest {

    @Test
    fun `parses host port and defaults`() {
        val r = DaemonEndpointParser.parse("192.168.1.10:18081")
        assertTrue(r.ok)
        assertEquals("192.168.1.10", r.endpoint!!.host)
        assertEquals(18081, r.endpoint!!.port)
        assertEquals("192.168.1.10:18081", r.endpoint!!.engineUrl)
    }

    @Test
    fun `http URI with path does not change engine host`() {
        val r = DaemonEndpointParser.parse("http://monerod.local:18089/json_rpc")
        assertTrue(r.ok)
        assertEquals("monerod.local:18089", r.endpoint!!.engineUrl)
        assertEquals("/json_rpc", r.endpoint!!.path)
    }

    @Test
    fun `https is rejected without rewrite`() {
        val r = DaemonEndpointParser.parse("https://192.168.1.10:18081")
        assertFalse(r.ok)
        assertEquals("https_unsupported", r.code)
    }

    @Test
    fun `illegal port does not fall back to default`() {
        val r = DaemonEndpointParser.parse("10.0.0.1:99999")
        assertFalse(r.ok)
        assertEquals("port", r.code)
    }

    @Test
    fun `IPv6 brackets`() {
        val r = DaemonEndpointParser.parse("[2001:db8::1]:18081")
        assertTrue(r.ok)
        assertEquals("[2001:db8::1]:18081", r.endpoint!!.engineUrl)
    }

    @Test
    fun `userinfo stripped from engineUrl`() {
        val r = DaemonEndpointParser.parse("http://user:secret@10.0.0.2:18081/")
        assertTrue(r.ok)
        assertTrue(r.endpoint!!.hasUserinfo)
        assertEquals("10.0.0.2:18081", r.endpoint!!.engineUrl)
        assertFalse(r.endpoint!!.engineUrl.contains("secret"))
    }

    @Test
    fun `scheme http colon alone is not host`() {
        // Classic bug: substringBefore('/') on http://host → "http:"
        val brokenLegacy = "http://192.168.1.10:18081".trim().substringBefore('/')
        assertEquals("http:", brokenLegacy)
        val r = DaemonEndpointParser.parse("http://192.168.1.10:18081")
        assertTrue(r.ok)
        assertEquals("192.168.1.10", r.endpoint!!.host)
        assertEquals(18081, r.endpoint!!.port)
    }

    @Test
    fun `whitespace rejected`() {
        assertFalse(DaemonEndpointParser.parse("192.168.1.10: 18081").ok)
    }

    @Test
    fun `loopback flagged`() {
        assertTrue(DaemonEndpointParser.parse("127.0.0.1").endpoint!!.isLoopback)
        assertTrue(DaemonEndpointParser.parse("localhost:18081").endpoint!!.isLoopback)
    }
}

class DaemonRpcProbeEvaluateTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `ready fixture is readyToMine`() {
        val root = json.parseToJsonElement(
            """{"result":{"height":100,"target_height":100,"synchronized":true,"mainnet":true,"nettype":"mainnet","version":"0.18","restricted":false}}"""
        ).jsonObject
        val r = DaemonRpcProbe.evaluateGetInfo(root, "10.0.0.1:18081", 1L)
        assertTrue(r.readyToMine)
        assertEquals("ready", r.code)
    }

    @Test
    fun `syncing is not ready`() {
        val root = json.parseToJsonElement(
            """{"result":{"height":1,"target_height":100,"synchronized":false,"mainnet":true,"nettype":"mainnet","version":"0.18"}}"""
        ).jsonObject
        val r = DaemonRpcProbe.evaluateGetInfo(root, "10.0.0.1:18081", 1L)
        assertFalse(r.readyToMine)
        assertEquals("sync", r.stage)
    }

    @Test
    fun `wrong network not ready`() {
        val root = json.parseToJsonElement(
            """{"result":{"height":1,"target_height":1,"synchronized":true,"mainnet":false,"nettype":"testnet","version":"0.18"}}"""
        ).jsonObject
        val r = DaemonRpcProbe.evaluateGetInfo(root, "10.0.0.1:18081", 1L)
        assertFalse(r.readyToMine)
        assertEquals("wrong_network", r.code)
    }

    @Test
    fun `restricted rpc not ready`() {
        val root = json.parseToJsonElement(
            """{"result":{"height":1,"target_height":1,"synchronized":true,"mainnet":true,"nettype":"mainnet","version":"0.18","restricted":true}}"""
        ).jsonObject
        val r = DaemonRpcProbe.evaluateGetInfo(root, "10.0.0.1:18081", 1L)
        assertFalse(r.readyToMine)
        assertEquals("restricted_rpc", r.code)
    }

    @Test
    fun `empty result is not ready — TCP alone insufficient`() {
        val root = json.parseToJsonElement("""{"result":{}}""").jsonObject
        val r = DaemonRpcProbe.evaluateGetInfo(root, "10.0.0.1:18081", 1L)
        assertFalse(r.readyToMine)
    }
}
