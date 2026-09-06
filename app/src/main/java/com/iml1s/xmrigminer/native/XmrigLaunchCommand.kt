package com.iml1s.xmrigminer.native

import java.io.File

/**
 * Builds the XMRig process argument list.
 * Config file carries pool/TLS/coin/donate settings.
 * Pass [threads] for exact `-t`; pass null for Auto (XMRig uses max-threads-hint from JSON).
 */
object XmrigLaunchCommand {
    fun build(
        binaryPath: String,
        configFile: File,
        threads: Int?,
        extraArgs: List<String> = emptyList()
    ): List<String> {
        require(binaryPath.isNotBlank()) { "XMRig binary path is blank" }
        if (threads != null) {
            require(threads > 0) { "Thread count must be positive" }
        }

        return buildList {
            add(binaryPath)
            add("-c")
            add(configFile.absolutePath)
            if (threads != null) {
                add("-t")
                add(threads.toString())
            }
            add("--no-color")
            addAll(extraArgs)
        }
    }
}
