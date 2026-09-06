package com.iml1s.xmrigminer.data.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

@Serializable
data class MiningConfig(
    val poolUrl: String = "pool.supportxmr.com:3333",
    val walletAddress: String = "",
    val workerName: String = "android",
    /** Exact thread count when [threadsAuto] is false. Ignored by argv when auto. */
    val threads: Int = defaultThreads(),
    /**
     * XMRig `cpu.max-threads-hint` (percent of logical CPUs for *auto* config).
     * Not a hard CPU utilization cap. Kept name for DataStore migration (#31).
     */
    val maxCpuUsage: Int = 75,
    /**
     * When true, omit `-t` and let XMRig autoconfig use [maxCpuUsage] as max-threads-hint.
     * When false, launch with `-t [threads]` and do not pretend hint is a CPU % limit.
     */
    val threadsAuto: Boolean = false,
    val useTls: Boolean = false,
    val autoReconnect: Boolean = true,
    val donateLevel: Int = 1,
    val customArgs: String = "",
    val retries: Int = 5,
    val retryPause: Int = 5,
    val printTime: Int = 10,
    val coinType: String = "MONERO",
    /** When true, XMRig uses monerod JSON-RPC (`daemon: true`) instead of a Stratum pool. Monero only. */
    val soloDaemon: Boolean = false
) {
    fun getCoin(): CoinType = CoinType.fromString(coinType)

    fun toJson(logFile: String? = null): String {
        val coin = getCoin()
        val solo = soloDaemon && coin == CoinType.MONERO
        val pool = buildJsonObject {
            when {
                solo -> put("coin", "monero")
                coin == CoinType.WOWNERO -> put("coin", "wownero")
                coin == CoinType.DERO -> {
                    put("coin", "dero")
                    put("algo", "astrobwt/v3")
                }
                else -> Unit
            }
            put("url", poolUrl)
            put("user", walletAddress)
            put("pass", if (solo) "x" else workerName)
            put("keepalive", !solo)
            put("tls", if (solo) false else useTls)
            if (solo) {
                put("daemon", true)
            }
        }
        val root = buildJsonObject {
            put("autosave", false)
            putJsonObject("cpu") {
                put("enabled", true)
                // Hint only applies in Auto mode; manual mode uses `-t` (#31).
                if (threadsAuto) {
                    put("max-threads-hint", maxCpuUsage)
                }
                put("priority", 1)
                put("asm", true)
                put("argon2-impl", "auto")
            }
            put("pools", JsonArray(listOf(pool)))
            put("donate-level", donateLevel)
            if (logFile != null) {
                put("log-file", logFile)
            } else {
                put("log-file", JsonNull)
            }
            put("print-time", printTime)
            put("health-print-time", printTime)
            put("retries", retries)
            put("retry-pause", retryPause)
            put("api", JsonNull)
            put("http", JsonNull)
            putJsonObject("randomx") {
                put("mode", if (coin == CoinType.WOWNERO) "light" else "auto")
                put("1gb-pages", false)
                put("rdmsr", false)
                put("wrmsr", false)
            }
        }
        return Json { prettyPrint = true }.encodeToString(JsonObject.serializer(), root)
    }

    fun isValid(): Boolean {
        val threadsOk = if (threadsAuto) true else threads > 0
        return walletAddress.isNotBlank() &&
               poolUrl.isNotBlank() &&
               threadsOk &&
               maxCpuUsage in 10..100 &&
               (!soloDaemon || getCoin() == CoinType.MONERO)
    }

    companion object {
        const val DEFAULT_SOLO_DAEMON_URL = "127.0.0.1:18081"

        /**
         * Never return 0 on single-core devices; never exceed [availableProcessors].
         */
        fun defaultThreads(availableProcessors: Int = Runtime.getRuntime().availableProcessors()): Int {
            val n = availableProcessors.coerceAtLeast(1)
            return (n - 1).coerceAtLeast(1).coerceAtMost(n)
        }

        fun getDefaultPoolUrl(coinType: CoinType): String {
            return when (coinType) {
                CoinType.MONERO -> "pool.supportxmr.com:3333"
                CoinType.WOWNERO -> "wownero.herominers.com:1111"
                CoinType.DERO -> "dero-node.mysrv.cloud:10100"
            }
        }

        fun isValidWalletAddress(address: String, coinType: CoinType): Boolean {
            if (address.isBlank()) return false
            return when (coinType) {
                CoinType.MONERO -> (address.startsWith("4") || address.startsWith("8")) && address.length in 95..106
                CoinType.WOWNERO -> address.startsWith("Wo") && address.length in 95..106
                CoinType.DERO -> address.startsWith("dero") && address.length >= 60
            }
        }
    }
}
