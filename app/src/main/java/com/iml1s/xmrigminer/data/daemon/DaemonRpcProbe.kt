package com.iml1s.xmrigminer.data.daemon

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import java.nio.charset.StandardCharsets

/**
 * Staged monerod readiness probe (#44). TCP connect alone is never "ready to mine".
 */
object DaemonRpcProbe {

    private val json = Json { ignoreUnknownKeys = true }

    data class ProbeResult(
        val ok: Boolean,
        val stage: String,
        val code: String,
        val message: String,
        val checkedAtEpochMs: Long,
        val readyToMine: Boolean,
        val engineUrl: String? = null,
        val height: Long? = null,
        val targetHeight: Long? = null,
        val remediation: String? = null
    )

    suspend fun probe(
        rawUrl: String?,
        timeoutMs: Int = 2500,
        allowHttps: Boolean = false,
        expectMainnet: Boolean = true
    ): ProbeResult {
        val checkedAt = System.currentTimeMillis()
        val parsed = DaemonEndpointParser.parse(rawUrl, allowHttps = allowHttps)
        if (!parsed.ok || parsed.endpoint == null) {
            return ProbeResult(
                ok = false,
                stage = "parse",
                code = parsed.code.ifBlank { "parse_error" },
                message = parsed.message.ifBlank { "Invalid daemon URL" },
                checkedAtEpochMs = checkedAt,
                readyToMine = false
            )
        }
        val ep = parsed.endpoint
        // Never log userinfo / secrets — engineUrl is already scrubbed.
        return withContext(Dispatchers.IO) {
            // DNS + TCP
            try {
                Socket().use { socket ->
                    socket.connect(InetSocketAddress(ep.host, ep.port), timeoutMs)
                }
            } catch (e: java.net.UnknownHostException) {
                return@withContext ProbeResult(
                    false, "dns", "dns_failed", "Could not resolve daemon hostname",
                    checkedAt, false, ep.engineUrl
                )
            } catch (e: Exception) {
                return@withContext ProbeResult(
                    false, "tcp", "tcp_failed", "TCP connect to daemon failed",
                    checkedAt, false, ep.engineUrl
                )
            }

            if (ep.scheme == "https" && !allowHttps) {
                return@withContext ProbeResult(
                    false, "tls", "https_unsupported",
                    "HTTPS daemon RPC is not supported in this build",
                    checkedAt, false, ep.engineUrl
                )
            }

            val rpcPath = when {
                ep.path.isNotBlank() -> ep.path
                else -> "/json_rpc"
            }
            val url = URL("http://${bracketHost(ep.host)}:${ep.port}$rpcPath")
            try {
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = timeoutMs
                    readTimeout = timeoutMs
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    // Intentionally no Authorization header from URI userinfo.
                }
                val body =
                    """{"jsonrpc":"2.0","id":"xmrig-multi","method":"get_info","params":{}}"""
                conn.outputStream.use { it.write(body.toByteArray(StandardCharsets.UTF_8)) }
                val code = conn.responseCode
                if (code == 401 || code == 403) {
                    return@withContext ProbeResult(
                        false, "mining_auth", "auth_denied",
                        "Daemon RPC authentication denied",
                        checkedAt, false, ep.engineUrl,
                        remediation = "Check RPC login in a separate secret field; credentials are never logged"
                    )
                }
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val text = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
                if (text.isBlank() || (!text.trimStart().startsWith('{') && !text.trimStart().startsWith('['))) {
                    return@withContext ProbeResult(
                        false, "rpc_version", "not_rpc",
                        "Endpoint is not a monerod JSON-RPC service",
                        checkedAt, false, ep.engineUrl
                    )
                }
                val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()
                    ?: return@withContext ProbeResult(
                        false, "rpc_version", "bad_json",
                        "Daemon returned unexpected JSON",
                        checkedAt, false, ep.engineUrl
                    )
                evaluateGetInfo(root, ep.engineUrl, checkedAt, expectMainnet)
            } catch (e: javax.net.ssl.SSLException) {
                ProbeResult(
                    false, "tls", "tls_failed", "TLS handshake with daemon failed",
                    checkedAt, false, ep.engineUrl
                )
            } catch (e: Exception) {
                ProbeResult(
                    false, "rpc_version", "rpc_failed",
                    "Daemon RPC probe failed",
                    checkedAt, false, ep.engineUrl
                )
            }
        }
    }

    /** Evaluate a get_info JSON object (also used by unit tests with fixtures). */
    fun evaluateGetInfo(
        root: JsonObject,
        engineUrl: String?,
        checkedAtEpochMs: Long,
        expectMainnet: Boolean = true
    ): ProbeResult {
        val info = root["result"]?.jsonObject ?: root
        val version = info["version"]?.jsonPrimitive?.contentOrNull
        val height = info["height"]?.jsonPrimitive?.longOrNull
        val hasShape = version != null || info["rpc_version"] != null || height != null
        if (!hasShape) {
            return ProbeResult(
                false, "rpc_version", "not_monerod",
                "Response does not look like monerod get_info",
                checkedAtEpochMs, false, engineUrl
            )
        }

        val nettype = (info["nettype"]?.jsonPrimitive?.contentOrNull
            ?: info["network_type"]?.jsonPrimitive?.contentOrNull
            ?: "").lowercase()
        val mainnetFlag = info["mainnet"]?.jsonPrimitive?.booleanOrNull
        if (expectMainnet) {
            if (nettype == "testnet" || nettype == "stagenet" || mainnetFlag == false) {
                return ProbeResult(
                    false, "network", "wrong_network",
                    "Daemon network is ${nettype.ifBlank { "non-mainnet" }}; expected mainnet",
                    checkedAtEpochMs, false, engineUrl, height = height
                )
            }
        }

        val targetHeight = info["target_height"]?.jsonPrimitive?.longOrNull
        val synchronizedFlag = info["synchronized"]?.jsonPrimitive?.booleanOrNull
        val syncing = synchronizedFlag == false ||
            (height != null && targetHeight != null && height + 2 < targetHeight)
        if (syncing) {
            return ProbeResult(
                false, "sync", "syncing",
                "Daemon is still synchronizing — wait before solo mining",
                checkedAtEpochMs, false, engineUrl, height = height, targetHeight = targetHeight
            )
        }
        if (synchronizedFlag == null && (height == null || targetHeight == null)) {
            return ProbeResult(
                false, "sync", "sync_unknown",
                "Daemon sync status unknown",
                checkedAtEpochMs, false, engineUrl, height = height, targetHeight = targetHeight
            )
        }

        val restricted = info["restricted"]?.jsonPrimitive?.booleanOrNull == true
        if (restricted) {
            return ProbeResult(
                false, "mining_auth", "restricted_rpc",
                "Restricted RPC cannot submit blocks for solo mining",
                checkedAtEpochMs, false, engineUrl, height = height,
                remediation = "Use unrestricted RPC on trusted LAN only — never expose publicly"
            )
        }

        return ProbeResult(
            true, "mining_auth", "ready",
            "Daemon RPC ready to mine",
            checkedAtEpochMs, true, engineUrl, height = height, targetHeight = targetHeight
        )
    }

    private fun bracketHost(host: String): String =
        if (':' in host && !host.startsWith("[")) "[$host]" else host
}
