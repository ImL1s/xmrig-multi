package com.iml1s.xmrigminer.data.ambient

/**
 * Android port of shared/ambient-clock (#74).
 */
enum class AmbientMode { CLOCK_ONLY, CLOCK_AND_MINE, REMOTE_WATCH }

data class AmbientModeResolution(
    val mode: AmbientMode,
    val showMinerCard: Boolean,
    val mayRequestMine: Boolean,
    val requiresWallet: Boolean,
    val requiresNetwork: Boolean,
    val remoteReady: Boolean = false
)

data class AmbientSideEffects(
    val startMiner: Boolean = false,
    val connectPool: Boolean = false,
    val requireWallet: Boolean = false,
    val loadRandomX: Boolean = false
)

object AmbientClockPolicy {
    fun resolve(
        requested: AmbientMode = AmbientMode.CLOCK_ONLY,
        hasWallet: Boolean = false,
        minerAvailable: Boolean = false,
        remotePaired: Boolean = false
    ): AmbientModeResolution = when (requested) {
        AmbientMode.CLOCK_ONLY -> AmbientModeResolution(
            mode = AmbientMode.CLOCK_ONLY,
            showMinerCard = false,
            mayRequestMine = false,
            requiresWallet = false,
            requiresNetwork = false
        )
        AmbientMode.REMOTE_WATCH -> AmbientModeResolution(
            mode = AmbientMode.REMOTE_WATCH,
            showMinerCard = true,
            mayRequestMine = false,
            requiresWallet = false,
            requiresNetwork = remotePaired,
            remoteReady = remotePaired
        )
        AmbientMode.CLOCK_AND_MINE -> AmbientModeResolution(
            mode = AmbientMode.CLOCK_AND_MINE,
            showMinerCard = true,
            mayRequestMine = minerAvailable && hasWallet,
            requiresWallet = true,
            requiresNetwork = false
        )
    }

    fun nextTickMs(nowMs: Long, showSeconds: Boolean = false): Long {
        return if (showSeconds) {
            1000L - (nowMs % 1000L)
        } else {
            60_000L - (nowMs % 60_000L)
        }
    }

    fun nightDimFactor(
        minuteOfDay: Int,
        nightStartMin: Int = 22 * 60,
        nightEndMin: Int = 6 * 60,
        nightFactor: Float = 0.35f
    ): Float {
        val inNight = when {
            nightStartMin == nightEndMin -> false
            nightStartMin < nightEndMin -> minuteOfDay in nightStartMin until nightEndMin
            else -> minuteOfDay >= nightStartMin || minuteOfDay < nightEndMin
        }
        return if (inNight) nightFactor else 1f
    }

    fun formatWallClock(
        hours: Int,
        minutes: Int,
        seconds: Int = 0,
        hour12: Boolean = false,
        showSeconds: Boolean = false
    ): String {
        var h = hours
        var suffix = ""
        if (hour12) {
            suffix = if (h >= 12) " PM" else " AM"
            h %= 12
            if (h == 0) h = 12
        }
        val base = if (showSeconds) {
            "%02d:%02d:%02d".format(h, minutes, seconds)
        } else {
            "%02d:%02d".format(h, minutes)
        }
        return base + suffix
    }

    fun sessionElapsedMs(startedMonoMs: Long?, nowMonoMs: Long): Long? {
        if (startedMonoMs == null) return null
        if (nowMonoMs < startedMonoMs) return null
        return nowMonoMs - startedMonoMs
    }

    fun redactAddress(address: String?): String? {
        if (address.isNullOrBlank()) return null
        if (address.length < 12) return "••••"
        return "${address.take(4)}…${address.takeLast(4)}"
    }

    fun sideEffects(resolution: AmbientModeResolution): AmbientSideEffects =
        AmbientSideEffects(
            startMiner = false,
            connectPool = false,
            requireWallet = resolution.requiresWallet && resolution.mode == AmbientMode.CLOCK_AND_MINE,
            loadRandomX = false
        )
}
