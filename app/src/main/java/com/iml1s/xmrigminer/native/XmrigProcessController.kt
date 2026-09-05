package com.iml1s.xmrigminer.native

/**
 * Stops an XMRig subprocess. Tries a graceful destroy first, then destroys again.
 *
 * Timed [Process.waitFor] and [Process.destroyForcibly] require API 26; this
 * helper stays on API 21 by polling [Process.exitValue] and using [Process.destroy].
 */
object XmrigProcessController {
    fun isAlive(process: Process?): Boolean {
        if (process == null) return false
        return try {
            process.exitValue()
            false
        } catch (_: IllegalThreadStateException) {
            true
        }
    }

    /**
     * @return true if the process is gone (or was already null)
     */
    fun stop(process: Process?, gracefulWaitMs: Long = 1500L): Boolean {
        if (process == null) return true

        if (!isAlive(process)) {
            return true
        }

        process.destroy()
        val stopped = waitQuietly(process, gracefulWaitMs)
        if (!stopped) {
            process.destroy()
            waitQuietly(process, 1000L)
        }
        return !isAlive(process)
    }

    private fun waitQuietly(process: Process, timeoutMs: Long): Boolean {
        if (timeoutMs <= 0L) {
            return try {
                process.waitFor()
                true
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                false
            }
        }

        val deadline = System.currentTimeMillis() + timeoutMs
        while (isAlive(process)) {
            val remaining = deadline - System.currentTimeMillis()
            if (remaining <= 0L) {
                return false
            }
            try {
                Thread.sleep(remaining.coerceAtMost(50L).coerceAtLeast(1L))
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                return !isAlive(process)
            }
        }
        return true
    }
}
