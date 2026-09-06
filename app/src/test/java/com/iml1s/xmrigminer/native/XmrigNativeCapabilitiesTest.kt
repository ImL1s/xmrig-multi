package com.iml1s.xmrigminer.native

import com.iml1s.xmrigminer.data.model.CoinType
import com.iml1s.xmrigminer.data.model.MiningConfig
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class XmrigNativeCapabilitiesTest {

    @get:Rule
    val tmp = TemporaryFolder()

    @Before
    fun reset() {
        XmrigNativeCapabilities.resetForTests()
    }

    @Test
    fun `uninitialized capabilities stay locked`() {
        assertFalse(XmrigNativeCapabilities.TLS_ENABLED)
        assertFalse(XmrigNativeCapabilities.HTTP_API_ENABLED)
        assertFalse(XmrigNativeCapabilities.BENCHMARK_ENABLED)
        assertFalse(XmrigNativeCapabilities.DAEMON_ENABLED)
        assertTrue(XmrigNativeCapabilities.isRestricted)
    }

    @Test
    fun `hash match unlocks declared gates`() {
        val binary = tmp.newFile("xmrig")
        binary.writeBytes(byteArrayOf(1, 2, 3, 4, 5))
        val sha = sha256(binary)
        val json = manifestJson(
            sha = sha,
            tls = true,
            http = true,
            bench = true,
            daemon = true
        )
        val snap = XmrigNativeCapabilities.loadJson(json, binary)
        assertTrue(snap.hashMatched)
        assertFalse(snap.restrictedMode)
        assertTrue(XmrigNativeCapabilities.TLS_ENABLED)
        assertTrue(XmrigNativeCapabilities.HTTP_API_ENABLED)
        assertTrue(XmrigNativeCapabilities.BENCHMARK_ENABLED)
        assertTrue(XmrigNativeCapabilities.DAEMON_ENABLED)
        assertTrue(XmrigNativeCapabilities.tlsTrustSummary().contains("fingerprint"))
    }

    @Test
    fun `hash mismatch enters restricted mode clearing feature gates`() {
        val binary = tmp.newFile("xmrig-bad")
        binary.writeBytes(byteArrayOf(9, 9, 9))
        val json = manifestJson(
            sha = "0".repeat(64),
            tls = true,
            http = true,
            bench = true,
            daemon = true
        )
        val snap = XmrigNativeCapabilities.loadJson(json, binary)
        assertFalse(snap.hashMatched)
        assertTrue(snap.restrictedMode)
        assertFalse(XmrigNativeCapabilities.TLS_ENABLED)
        assertFalse(XmrigNativeCapabilities.HTTP_API_ENABLED)
        assertFalse(XmrigNativeCapabilities.BENCHMARK_ENABLED)
        assertFalse(XmrigNativeCapabilities.DAEMON_ENABLED)
    }

    @Test
    fun `missing binary is restricted`() {
        val json = manifestJson(
            sha = "a".repeat(64),
            tls = true,
            http = true,
            bench = true,
            daemon = true
        )
        val snap = XmrigNativeCapabilities.loadJson(json, binaryFile = null)
        assertTrue(snap.restrictedMode)
        assertFalse(XmrigNativeCapabilities.TLS_ENABLED)
    }

    @Test
    fun `solo daemon blocked on legacy HTTP-off package`() {
        XmrigNativeCapabilities.installSnapshotForTests(
            XmrigNativeCapabilities.Snapshot(
                binarySha256 = "x",
                tlsDeclared = false,
                httpApiDeclared = false,
                benchmarkDeclared = false,
                daemonDeclared = false,
                hashMatched = true,
                restrictedMode = false
            )
        )
        val config = MiningConfig(
            poolUrl = MiningConfig.DEFAULT_SOLO_DAEMON_URL,
            walletAddress = "4" + "A".repeat(94),
            soloDaemon = true
        )
        val err = XmrigNativeCapabilities.assertSoloDaemonAllowed(config)
        assertNotNull(err)
        assertTrue(err!!.contains("#134"))
    }

    @Test
    fun `cpu gate refuses when crypto features missing`() {
        XmrigNativeCapabilities.installSnapshotForTests(
            XmrigNativeCapabilities.Snapshot(
                binarySha256 = "x",
                tlsDeclared = true,
                httpApiDeclared = true,
                benchmarkDeclared = true,
                daemonDeclared = true,
                requiredCpuInstructions = listOf("armv8-a", "crypto"),
                hashMatched = true,
                restrictedMode = false
            )
        )
        val err = XmrigNativeCapabilities.assertCpuFeatures("fp asimd evtstrm")
        assertNotNull(err)
        assertTrue(err!!.contains("SIGILL") || err.contains("crypto"))
        assertNull(XmrigNativeCapabilities.assertCpuFeatures("fp asimd aes pmull sha1 sha2"))
    }

    @Test
    fun `assertTlsPin fails without pin when useTls`() {
        XmrigNativeCapabilities.installSnapshotForTests(
            XmrigNativeCapabilities.Snapshot(
                binarySha256 = "x",
                tlsDeclared = true,
                httpApiDeclared = true,
                benchmarkDeclared = true,
                daemonDeclared = true,
                hashMatched = true,
                restrictedMode = false
            )
        )
        val noPin = MiningConfig(
            poolUrl = "pool.supportxmr.com:443",
            walletAddress = "4" + "A".repeat(94),
            useTls = true,
            tlsFingerprint = ""
        )
        val err = XmrigNativeCapabilities.assertTlsPin(noPin)
        assertNotNull(err)
        assertTrue(err!!.contains("#134"))
        assertTrue(err.contains("fingerprint") || err.contains("SHA-256"))
    }

    @Test
    fun `assertTlsPin passes with valid 64-hex fingerprint`() {
        XmrigNativeCapabilities.installSnapshotForTests(
            XmrigNativeCapabilities.Snapshot(
                binarySha256 = "x",
                tlsDeclared = true,
                httpApiDeclared = true,
                benchmarkDeclared = true,
                daemonDeclared = true,
                hashMatched = true,
                restrictedMode = false
            )
        )
        val ok = MiningConfig(
            poolUrl = "pool.supportxmr.com:443",
            walletAddress = "4" + "A".repeat(94),
            useTls = true,
            tlsFingerprint = "ab".repeat(32)
        )
        assertNull(XmrigNativeCapabilities.assertTlsPin(ok))
        assertNull(
            XmrigNativeCapabilities.assertTlsPin(
                ok.copy(useTls = false, tlsFingerprint = "")
            )
        )
        assertTrue(XmrigNativeCapabilities.tlsTrustSummary().contains("fingerprint"))
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

    private fun manifestJson(
        sha: String,
        tls: Boolean,
        http: Boolean,
        bench: Boolean,
        daemon: Boolean
    ): String = """
        {
          "schemaVersion": 1,
          "binary": { "sha256": "$sha" },
          "cpu": { "requiredInstructions": ["armv8-a", "crypto"] },
          "capabilities": {
            "httpApi": { "declared": $http, "selftest": "pass", "deviceVerified": false },
            "tls": {
              "declared": $tls,
              "selftest": "pass",
              "deviceVerified": false,
              "trustModel": "fingerprint"
            },
            "benchmark": { "declared": $bench, "selftest": "pass", "deviceVerified": false },
            "daemon": { "declared": $daemon, "selftest": "pass", "deviceVerified": false }
          }
        }
    """.trimIndent()

    private fun sha256(file: File): String {
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        digest.update(file.readBytes())
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
