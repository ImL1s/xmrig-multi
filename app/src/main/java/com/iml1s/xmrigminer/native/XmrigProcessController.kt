package com.iml1s.xmrigminer.native

import android.os.Build
import android.os.Process as AndroidProcess
import java.io.File

/**
 * Stops an XMRig subprocess.
 *
 * On Android, [Process.destroy] alone can leave RandomX miners alive. API 26+ uses
 * [Process.destroyForcibly], then same-UID [AndroidProcess.killProcess].
 *
 * [killLeftoverMiners] is the belt-and-suspenders path used when WorkManager reports
 * cancelled before the worker's finally block has torn the child down.
 */
object XmrigProcessController {
    /** Packaged jniLibs name and asset-fallback extract name from [XmrigBinaryResolver]. */
    private val MINER_EXECUTABLE_NAMES = setOf("libxmrig.so", XmrigBinaryResolver.EXTRACTED_NAME)

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

        val pid = pidOf(process)

        process.destroy()
        if (waitQuietly(process, gracefulWaitMs)) {
            return true
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            process.destroyForcibly()
        } else {
            process.destroy()
        }
        if (waitQuietly(process, 1000L)) {
            return true
        }

        if (pid != null && pid > 0) {
            AndroidProcess.killProcess(pid)
            waitQuietly(process, 500L)
        }
        return !isAlive(process)
    }

    /**
     * True when [cmdline] is an XMRig binary we launched (`libxmrig.so` or extracted `xmrig`),
     * not merely a process whose args mention the app package name.
     */
    fun isMinerCommandLine(cmdline: String): Boolean {
        val exe = cmdline.substringBefore('\u0000').ifBlank {
            cmdline.substringBefore(' ').ifBlank { cmdline }
        }
        val name = File(exe).name
        return name in MINER_EXECUTABLE_NAMES
    }

    /**
     * Kill same-UID leftover miner processes. Skips our own JVM pid.
     *
     * @return number of kill attempts
     */
    fun killLeftoverMiners(): Int {
        val self = try {
            AndroidProcess.myPid()
        } catch (_: Throwable) {
            // JVM unit tests use Android stubs that throw; nothing to sweep there.
            return 0
        }
        var attempts = 0
        val dirs = try {
            File("/proc").listFiles()
        } catch (_: Throwable) {
            null
        } ?: return 0
        for (dir in dirs) {
            val pid = dir.name.toIntOrNull() ?: continue
            if (pid == self) continue
            val cmdline = try {
                File(dir, "cmdline").readBytes().toString(Charsets.UTF_8)
            } catch (_: Exception) {
                continue
            }
            if (!isMinerCommandLine(cmdline)) continue
            try {
                AndroidProcess.killProcess(pid)
                attempts++
            } catch (_: Throwable) {
                // Ignore stub / permission failures.
            }
        }
        return attempts
    }

    fun pidOf(process: Process?): Int? {
        if (process == null) return null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                val method = Process::class.java.getMethod("pid")
                val value = method.invoke(process) ?: return null
                return when (value) {
                    is Long -> value.toInt()
                    is Int -> value
                    else -> value.toString().toIntOrNull()
                }
            } catch (_: Throwable) {
                // Fall through.
            }
        }
        return try {
            val field = process.javaClass.getDeclaredField("pid")
            field.isAccessible = true
            field.getInt(process)
        } catch (_: Throwable) {
            Regex("""pid[=:\s]+(\d+)""", RegexOption.IGNORE_CASE)
                .find(process.toString())
                ?.groupValues
                ?.get(1)
                ?.toIntOrNull()
        }
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
