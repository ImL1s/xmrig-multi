package com.iml1s.xmrigminer.wear

/**
 * Wear Data Layer should not wake radios every uptime tick.
 * Push immediately for start/stop or an explicit refresh; otherwise batch.
 */
internal object WearStatsPushPolicy {
    const val INTERVAL_MS = 15_000L

    fun shouldPush(
        nowMs: Long,
        lastPushAtMs: Long,
        runningChanged: Boolean,
        force: Boolean
    ): Boolean {
        if (force || runningChanged) return true
        return nowMs - lastPushAtMs >= INTERVAL_MS
    }

    fun urgent(runningChanged: Boolean, force: Boolean): Boolean = runningChanged || force
}
