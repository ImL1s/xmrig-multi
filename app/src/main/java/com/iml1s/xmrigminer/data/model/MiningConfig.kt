package com.iml1s.xmrigminer.data.model

import kotlinx.serialization.Serializable

@Serializable
data class MiningConfig(
    val poolUrl: String = "pool.supportxmr.com:3333",
    val walletAddress: String = "",
    val workerName: String = "android",
    val threads: Int = Runtime.getRuntime().availableProcessors() - 1,
    val maxCpuUsage: Int = 75,
    val useTls: Boolean = true,
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
        val coinConfig = when (coin) {
            CoinType.MONERO -> ""  // Monero 不需要額外配置
            CoinType.WOWNERO -> """
                "coin": "wownero",
            """.trimIndent()
            CoinType.DERO -> """
                "coin": "dero",
                "algo": "astrobwt/v3",
            """.trimIndent()
        }

        val randomxConfig = when (coin) {
            CoinType.WOWNERO -> """
            "randomx": {
                "mode": "light",
                "1gb-pages": false,
                "rdmsr": false,
                "wrmsr": false
            }
            """.trimIndent()
            else -> """
            "randomx": {
                "mode": "auto",
                "1gb-pages": false,
                "rdmsr": false,
                "wrmsr": false
            }
            """.trimIndent()
        }

        return """
        {
            "autosave": false,
            "cpu": {
                "enabled": true,
                "max-threads-hint": $maxCpuUsage,
                "priority": 1,
                "asm": true,
                "argon2-impl": "auto"
            },
            "pools": [
                {
                    $coinConfig
                    "url": "$poolUrl",
                    "user": "$walletAddress",
                    "pass": "$workerName",
                    "keepalive": true,
                    "tls": $useTls
                }
            ],
            "donate-level": $donateLevel,
            "log-file": ${logFile?.let { "\"$it\"" } ?: "null"},
            "print-time": $printTime,
            "health-print-time": $printTime,
            "retries": $retries,
            "retry-pause": $retryPause,
            "api": null,
            "http": null,
            $randomxConfig
        }
        """.trimIndent()
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
