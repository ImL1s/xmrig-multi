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
    val threads: Int = Runtime.getRuntime().availableProcessors() - 1,
    val maxCpuUsage: Int = 75,
    val useTls: Boolean = false,
    val autoReconnect: Boolean = true,
    val donateLevel: Int = 1,
    val customArgs: String = "",
    val retries: Int = 5,
    val retryPause: Int = 5,
    val printTime: Int = 10,
    val coinType: String = "MONERO"
) {
    fun getCoin(): CoinType = CoinType.fromString(coinType)

    fun toJson(logFile: String? = null): String {
        val coin = getCoin()
        val pool = buildJsonObject {
            when (coin) {
                CoinType.WOWNERO -> put("coin", "wownero")
                CoinType.DERO -> {
                    put("coin", "dero")
                    put("algo", "astrobwt/v3")
                }
                CoinType.MONERO -> Unit
            }
            put("url", poolUrl)
            put("user", walletAddress)
            put("pass", workerName)
            put("keepalive", true)
            put("tls", useTls)
        }
        val root = buildJsonObject {
            put("autosave", false)
            putJsonObject("cpu") {
                put("enabled", true)
                put("max-threads-hint", maxCpuUsage)
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
        return walletAddress.isNotBlank() &&
               poolUrl.isNotBlank() &&
               threads > 0 &&
               maxCpuUsage in 10..100
    }

    companion object {
        // 預設礦池 URL 依幣種
        fun getDefaultPoolUrl(coinType: CoinType): String {
            return when (coinType) {
                CoinType.MONERO -> "pool.supportxmr.com:3333"
                CoinType.WOWNERO -> "wownero.herominers.com:1111"
                CoinType.DERO -> "dero-node.mysrv.cloud:10100"
            }
        }

        // 錢包地址格式驗證
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
