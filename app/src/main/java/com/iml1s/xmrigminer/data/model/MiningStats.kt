package com.iml1s.xmrigminer.data.model

data class MiningStats(
    val hashrate: Double = 0.0,
    val hashrate10s: Double = 0.0,
    val hashrate60s: Double = 0.0,
    val hashrate15m: Double = 0.0,
    val acceptedShares: Int = 0,
    val rejectedShares: Int = 0,
    val cpuUsage: Float = 0f,
    val temperature: Float = 0f,
    val batteryLevel: Int = 100,
    val isCharging: Boolean = false,
    val uptime: Long = 0L,
    val difficulty: Long = 0L,
    /** Today energy from session meter (#130); null = unknown (not free). */
    val energyKwhToday: Double? = null,
    val energyFiatToday: Double? = null,
    val energyCurrency: String = "TWD",
    val energyQuality: String = "unknown",
    val energySourceLabel: String = "unset"
) {
    val successRate: Float
        get() = if (acceptedShares + rejectedShares > 0) {
            (acceptedShares.toFloat() / (acceptedShares + rejectedShares)) * 100
        } else 0f
}
