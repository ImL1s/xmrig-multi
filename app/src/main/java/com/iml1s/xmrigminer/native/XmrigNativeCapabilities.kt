package com.iml1s.xmrigminer.native

import com.iml1s.xmrigminer.data.model.CoinType
import com.iml1s.xmrigminer.data.model.MiningConfig
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import timber.log.Timber
import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/**
 * Runtime capabilities of the packaged Android XMRig engine (#134).
 *
 * Loaded from `native-capabilities.json` via kotlinx.serialization.json (not org.json —
 * unit-test stubs throw). Binary SHA-256 must match the manifest; mismatch enters
 * restricted mode (TLS / HTTP / benchmark / daemon gates cleared). Coin gates (#27/#28)
 * and MoneroOcean (#29) stay independent of the hash gate.
 */
object XmrigNativeCapabilities {

    const val TLS_UNSUPPORTED_MESSAGE =
        "此 Android 礦機未編譯 TLS，請關閉 Use TLS/SSL 並使用非 SSL 礦池埠"

    const val SOLO_DAEMON_UNSUPPORTED_MESSAGE =
        "Solo/daemon 需要 WITH_HTTP=ON 的原生建置；目前二進位未宣告 daemon 能力 (#134)"

    const val CAPABILITIES_ASSET = "native-capabilities.json"

    enum class CoinStatus {
        SUPPORTED,
        UNAVAILABLE
    }

    data class CoinCapability(
        val status: CoinStatus,
        val reason: String
    )

    data class Snapshot(
        val binarySha256: String,
        val tlsDeclared: Boolean,
        val httpApiDeclared: Boolean,
        val benchmarkDeclared: Boolean,
        val daemonDeclared: Boolean,
        val tlsTrustModel: String = "fingerprint",
        val requiredCpuInstructions: List<String> = listOf("armv8-a", "crypto"),
        val hashMatched: Boolean,
        val restrictedMode: Boolean
    )

    private val coinCapabilities = mapOf(
        CoinType.MONERO to CoinCapability(
            CoinStatus.SUPPORTED,
            "Packaged XMRig RandomX (rx/0) Stratum path"
        ),
        CoinType.WOWNERO to CoinCapability(
            CoinStatus.UNAVAILABLE,
            "Wownero presets unverified; need trusted signer/daemon flow before start (#28)"
        ),
        CoinType.DERO to CoinCapability(
            CoinStatus.UNAVAILABLE,
            "DERO requires a dedicated daemon miner adapter, not XMRig astrobwt/v3 Stratum (#27)"
        )
    )

    @Volatile
    private var snapshot: Snapshot? = null

    /** Uninitialized / restricted until a matching binary+manifest load succeeds. */
    val TLS_ENABLED: Boolean
        get() = snapshot?.let { it.tlsDeclared && !it.restrictedMode } == true

    val HTTP_API_ENABLED: Boolean
        get() = snapshot?.let { it.httpApiDeclared && !it.restrictedMode } == true

    val BENCHMARK_ENABLED: Boolean
        get() = snapshot?.let { it.benchmarkDeclared && !it.restrictedMode } == true

    val DAEMON_ENABLED: Boolean
        get() = snapshot?.let { it.daemonDeclared && !it.restrictedMode } == true

    val isRestricted: Boolean
        get() = snapshot?.restrictedMode != false

    fun capabilityFor(coin: CoinType): CoinCapability =
        coinCapabilities[coin] ?: CoinCapability(
            CoinStatus.UNAVAILABLE,
            "Unknown coin"
        )

    fun assertStartAllowed(coin: CoinType): String? {
        val cap = capabilityFor(coin)
        return if (cap.status == CoinStatus.SUPPORTED) null else cap.reason
    }

    /** MoneroOcean pays XMR; reject non-Monero coin pairing (#29). */
    fun assertMoneroOceanPayout(poolNameOrUrl: String, coin: CoinType, wallet: String): String? {
        val key = poolNameOrUrl.lowercase()
        if (!key.contains("moneroocean")) return null
        if (coin != CoinType.MONERO) {
            return "MoneroOcean 以 XMR 收款，不可使用 ${coin.displayName} 地址當付款帳號 (#29)"
        }
        val ok = (wallet.startsWith("4") || wallet.startsWith("8")) && wallet.length >= 95
        return if (ok) null else "MoneroOcean 需要有效的 Monero 收款地址（4… / 8…）"
    }

    /** Solo/daemon requires WITH_HTTP-backed daemon capability (#134). */
    fun assertSoloDaemonAllowed(config: MiningConfig): String? {
        if (!config.soloDaemon) return null
        if (!DAEMON_ENABLED) return SOLO_DAEMON_UNSUPPORTED_MESSAGE
        return null
    }

    /**
     * Refuse start when required ARMv8 crypto features are missing (SIGILL policy).
     * @param cpuInfoFeatures optional Features= line from /proc/cpuinfo for tests
     */
    fun assertCpuFeatures(cpuInfoFeatures: String? = null): String? {
        val required = snapshot?.requiredCpuInstructions.orEmpty()
        if (required.isEmpty()) return null
        if (!required.any { it.contains("crypto", ignoreCase = true) }) return null

        val features = cpuInfoFeatures ?: readProcCpuFeatures() ?: return null
        val lower = features.lowercase()
        // ARMv8 Crypto Extension typically exposes aes / pmull / sha1 / sha2 in Features.
        val hasCrypto = listOf("aes", "pmull", "sha1", "sha2", "sha256", "sha512")
            .any { lower.contains(it) }
        if (!hasCrypto) {
            return "CPU 缺少 ARMv8 crypto 延伸指令，拒絕啟動以免 SIGILL (#134)"
        }
        return null
    }

    fun tlsTrustSummary(): String {
        val model = snapshot?.tlsTrustModel ?: "fingerprint"
        return when (model) {
            "fingerprint" ->
                "Pool TLS 使用憑證 fingerprint 驗證（非完整 CA/hostname 身分驗證）(#134)"
            else ->
                "TLS trust model: $model"
        }
    }

    fun resetForTests() {
        snapshot = null
    }

    fun installSnapshotForTests(snapshot: Snapshot) {
        this.snapshot = snapshot
    }

    /**
     * Parse manifest JSON and optionally verify [binaryFile] SHA-256.
     * Missing binary → restricted. Hash mismatch → restricted (gates cleared).
     */
    fun loadJson(json: String, binaryFile: File? = null): Snapshot {
        val root = Json.parseToJsonElement(json).jsonObject
        val caps = root["capabilities"]?.jsonObject
            ?: error("native-capabilities.json missing capabilities")
        val binaryObj = root["binary"]?.jsonObject
        val expectedSha = binaryObj?.get("sha256")?.jsonPrimitive?.contentOrNull.orEmpty()

        val tlsDeclared = caps["tls"]?.jsonObject?.get("declared")?.jsonPrimitive?.boolean == true
        val httpDeclared = caps["httpApi"]?.jsonObject?.get("declared")?.jsonPrimitive?.boolean == true
        val benchDeclared = caps["benchmark"]?.jsonObject?.get("declared")?.jsonPrimitive?.boolean == true
        val daemonDeclared = caps["daemon"]?.jsonObject?.get("declared")?.jsonPrimitive?.boolean == true
        val trustModel = caps["tls"]?.jsonObject?.get("trustModel")?.jsonPrimitive?.contentOrNull
            ?: "fingerprint"

        val cpuReq = root["cpu"]?.jsonObject?.get("requiredInstructions")?.jsonArray
            ?.mapNotNull { it.jsonPrimitive.contentOrNull }
            ?: listOf("armv8-a", "crypto")

        val (hashMatched, restricted) = when {
            binaryFile == null || !binaryFile.isFile -> false to true
            expectedSha.isBlank() -> false to true
            else -> {
                val actual = sha256Hex(binaryFile)
                val match = actual.equals(expectedSha, ignoreCase = true)
                match to !match
            }
        }

        val snap = Snapshot(
            binarySha256 = expectedSha,
            tlsDeclared = tlsDeclared,
            httpApiDeclared = httpDeclared,
            benchmarkDeclared = benchDeclared,
            daemonDeclared = daemonDeclared,
            tlsTrustModel = trustModel,
            requiredCpuInstructions = cpuReq,
            hashMatched = hashMatched,
            restrictedMode = restricted
        )
        snapshot = snap
        if (restricted) {
            Timber.w(
                "XmrigNativeCapabilities restricted mode (hashMatched=%s expected=%s)",
                hashMatched,
                expectedSha.take(12)
            )
        } else {
            Timber.i(
                "XmrigNativeCapabilities unlocked tls=%s http=%s bench=%s daemon=%s",
                tlsDeclared,
                httpDeclared,
                benchDeclared,
                daemonDeclared
            )
        }
        return snap
    }

    fun load(openAsset: (String) -> InputStream?, binaryFile: File): Snapshot {
        val stream = openAsset(CAPABILITIES_ASSET)
            ?: error("$CAPABILITIES_ASSET missing from assets")
        val json = stream.bufferedReader().use { it.readText() }
        return loadJson(json, binaryFile)
    }

    private fun readProcCpuFeatures(): String? {
        return try {
            val text = File("/proc/cpuinfo").takeIf { it.canRead() }?.readText() ?: return null
            text.lineSequence()
                .firstOrNull { it.startsWith("Features", ignoreCase = true) }
                ?.substringAfter(':')
                ?.trim()
        } catch (_: Exception) {
            null
        }
    }

    private fun sha256Hex(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(8192)
            while (true) {
                val n = input.read(buf)
                if (n <= 0) break
                digest.update(buf, 0, n)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
