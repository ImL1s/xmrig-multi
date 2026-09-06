package com.iml1s.xmrigminer.service

/**
 * Helpers for miner-scoped CPU sampling (#54).
 */
object ProcStatCpu {
    /**
     * Parse utime+stime from `/proc/[pid]/stat`. Comm may contain spaces inside `(...)`.
     */
    fun parseCpuJiffies(statText: String): Long? {
        val close = statText.lastIndexOf(')')
        if (close < 0 || close + 2 >= statText.length) return null
        val rest = statText.substring(close + 2).trim().split(Regex("\\s+"))
        if (rest.size < 13) return null
        val utime = rest[11].toLongOrNull() ?: return null
        val stime = rest[12].toLongOrNull() ?: return null
        return utime + stime
    }
}
