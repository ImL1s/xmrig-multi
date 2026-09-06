package com.iml1s.xmrigminer.data.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import com.iml1s.xmrigminer.native.XmrigHttpApiSession
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
    /** SHA-256 cert fingerprint for XMRig `pools[].fingerprint` when [useTls] (#134). */
    val tlsFingerprint: String = "",
    val autoReconnect: Boolean = true,
    val donateLevel: Int = 1,
    val customArgs: String = "",
    val retries: Int = 5,
    val retryPause: Int = 5,
    val printTime: Int = 10,
    val coinType: String = "MONERO",
    /** When true, XMRig uses monerod JSON-RPC (`daemon: true`) instead of a Stratum pool. Monero only. */
    val soloDaemon: Boolean = false,
    /**
     * Requested RandomX mode: auto|fast|light (#35).
     * Effective mode may fall back at launch; permanent value is only changed when user edits it.
     */
    val randomxMode: String = "auto",
    /** When true, auto memory fallback must not overwrite [randomxMode]. */
    val randomxModeLocked: Boolean = false,
    // --- Power policy (persisted; MonitorWorker must read these, not hardcoded) (#126) ---
    /** When true, mining requires AC/USB/wireless present. */
    val requireExternalPower: Boolean = false,
    /** Pause when charger is removed. */
    val pauseOnUnplug: Boolean = false,
    /** Charge to this SOC% before mining while plugged; null disables. */
    val chargeToPercentBeforeMine: Int? = null,
    val minBatteryPercent: Int = 20,
    val resumeBatteryPercent: Int = 30,
    /** Pause when plugged but net battery flow is still discharging. */
    val pauseOnNetDischargeWhilePlugged: Boolean = false,
    /**
     * When true, [com.iml1s.xmrigminer.service.MiningDreamService] may request the shared
     * MiningController while dreaming. Clock-only screensaver when false (#127).
     */
    val dreamMayMine: Boolean = false,
    // --- Energy / budget (#130) — null watts/rate means unknown, never invent 0 ---
    /** Manual wall/device watts for session metering (quality=manual). */
    val manualWatts: Double? = null,
    /** Fixed fiat per kWh; progressive/TOU presets stay unverified. */
    val electricityRatePerKwh: Double? = null,
    val electricityCurrency: String = "TWD",
    /** Daily spend cap in [electricityCurrency]; null disables. */
    val dailySpendCapFiat: Double? = null,
    /** Daily energy cap in kWh; null disables. */
    val dailyKwhCap: Double? = null,
    /** Monthly spend cap; null disables. */
    val monthlySpendCapFiat: Double? = null
) {
    fun getCoin(): CoinType = CoinType.fromString(coinType)

    fun selectRandomxMode(
        availableBytes: Long? = null,
        totalBytes: Long? = null,
        processLimitBytes: Long? = null,
        allocationFailed: Boolean = false,
        confirmSoftOverride: Boolean = false
    ): com.iml1s.xmrigminer.data.hardware.RandomXMemoryBudget.Selection {
        val coin = getCoin()
        if (coin == CoinType.DERO) {
            return com.iml1s.xmrigminer.data.hardware.RandomXMemoryBudget.select(
                algorithm = coin.name,
                requestedMode = "auto"
            )
        }
        val requested = when {
            coin == CoinType.WOWNERO && randomxMode == "auto" -> "light"
            else -> normalizeRandomxMode(randomxMode)
        }
        return com.iml1s.xmrigminer.data.hardware.RandomXMemoryBudget.select(
            algorithm = coin.name,
            requestedMode = requested,
            locked = randomxModeLocked,
            threads = if (threadsAuto) 1 else threads.coerceAtLeast(1),
            availableBytes = availableBytes,
            totalBytes = totalBytes,
            processLimitBytes = processLimitBytes,
            confirmSoftOverride = confirmSoftOverride,
            allocationFailed = allocationFailed
        )
    }

    /**
     * Resolved RandomX mode for config JSON. Returns null when the memory gate
     * blocks launch — callers must not invent a mode and start XMRig (#129).
     */
    fun resolvedRandomxMode(
        availableBytes: Long? = null,
        totalBytes: Long? = null,
        processLimitBytes: Long? = null,
        allocationFailed: Boolean = false
    ): String? {
        val coin = getCoin()
        if (coin == CoinType.DERO) return "auto"
        val sel = selectRandomxMode(
            availableBytes = availableBytes,
            totalBytes = totalBytes,
            processLimitBytes = processLimitBytes,
            allocationFailed = allocationFailed
        )
        if (sel.blocked || !sel.ok) return null
        return sel.appliedMode
    }

    fun toJson(
        logFile: String? = null,
        availableMemoryBytes: Long? = null,
        totalMemoryBytes: Long? = null,
        processLimitBytes: Long? = null,
        appliedRandomxMode: String? = null,
        httpApi: XmrigHttpApiSession? = null,
        /** When null, use [MiningConfig.tlsFingerprint]. Callers must validate before TLS start. */
        tlsFingerprint: String? = null
    ): String {
        val coin = getCoin()
        val solo = soloDaemon && coin == CoinType.MONERO
        val rxMode = appliedRandomxMode
            ?: resolvedRandomxMode(
                availableBytes = availableMemoryBytes,
                totalBytes = totalMemoryBytes,
                processLimitBytes = processLimitBytes
            )
            ?: throw IllegalStateException(
                "Memory gate blocked RandomX mode — refuse config launch (#129)"
            )
        val pin = (tlsFingerprint ?: this.tlsFingerprint).trim()
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
            if (!solo && useTls && pin.isNotEmpty()) {
                put("fingerprint", normalizeTlsFingerprint(pin))
            }
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
            // autoReconnect=false must disable XMRig's own retry loop (#43)
            put("retries", if (autoReconnect) retries else 0)
            put("retry-pause", retryPause)
            if (httpApi != null) {
                putJsonObject("api") {
                    put("id", httpApi.instanceId)
                    put("worker-id", workerName)
                }
                putJsonObject("http") {
                    put("enabled", true)
                    put("host", httpApi.host)
                    put("port", httpApi.port)
                    put("access-token", httpApi.accessToken)
                    put("restricted", !httpApi.allowWrites)
                }
            } else {
                put("api", JsonNull)
                put("http", JsonNull)
            }
            putJsonObject("randomx") {
                put("mode", rxMode)
                put("1gb-pages", false)
                put("rdmsr", false)
                put("wrmsr", false)
            }
        }
        return Json { prettyPrint = true }.encodeToString(JsonObject.serializer(), root)
    }

    fun isValid(): Boolean {
        val threadsOk = if (threadsAuto) true else threads > 0
        return isValidWalletAddress(walletAddress, getCoin()) &&
               poolUrl.isNotBlank() &&
               threadsOk &&
               maxCpuUsage in 10..100 &&
               (!soloDaemon || getCoin() == CoinType.MONERO) &&
               normalizeRandomxMode(randomxMode) in setOf("auto", "fast", "light")
    }

    companion object {
        const val DEFAULT_SOLO_DAEMON_URL = "127.0.0.1:18081"

        /** Strip colons/spaces and lowercase for XMRig fingerprint pin (#134). */
        fun normalizeTlsFingerprint(raw: String): String =
            raw.filter { it != ':' && !it.isWhitespace() }.lowercase()

        /** True when [raw] normalizes to exactly 64 hex chars (SHA-256 cert fingerprint). */
        fun isValidTlsFingerprint(raw: String): Boolean {
            val pin = normalizeTlsFingerprint(raw)
            return pin.length == 64 && pin.all { it in '0'..'9' || it in 'a'..'f' }
        }

        fun normalizeRandomxMode(mode: String): String =
            when (mode.lowercase()) {
                "fast", "light", "auto" -> mode.lowercase()
                else -> "auto"
            }

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
            val coin = when (coinType) {
                CoinType.MONERO -> "monero"
                CoinType.WOWNERO -> "wownero"
                CoinType.DERO -> "dero"
            }
            return com.iml1s.xmrigminer.data.wallet.WalletAddressValidator
                .validate(address, coin).ok
        }
    }
}

