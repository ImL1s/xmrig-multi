package com.iml1s.xmrigminer.native

import java.util.concurrent.TimeUnit

/**
 * Stops an XMRig subprocess. Tries a graceful destroy first, then forcibly kills.
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
            process.destroyForcibly()
            waitQuietly(process, 1000L)
        }
        return !isAlive(process)
    }

    private fun waitQuietly(process: Process, timeoutMs: Long): Boolean {
        return try {
            if (timeoutMs <= 0L) {
                process.waitFor()
                true
            } else {
                process.waitFor(timeoutMs, TimeUnit.MILLISECONDS)
            }
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            false
        }
    }
}
