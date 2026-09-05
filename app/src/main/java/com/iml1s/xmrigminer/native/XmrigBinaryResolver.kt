package com.iml1s.xmrigminer.native

import java.io.File
import java.io.InputStream

/**
 * Resolves the XMRig executable.
 *
 * Preference order:
 * 1. Packaged native library `libxmrig.so` (jniLibs)
 * 2. Asset fallback copied into app files (`xmrig_arm64`, `xmrig`, `libxmrig.so`)
 */
class XmrigBinaryResolver(
    private val nativeLibraryDir: File,
    private val filesDir: File,
    private val openAsset: (String) -> InputStream?
) {
    fun resolve(): File {
        val packaged = File(nativeLibraryDir, PACKAGED_NAME)
        if (packaged.isFile) {
            return packaged
        }

        val dest = File(filesDir, EXTRACTED_NAME)
        for (assetName in ASSET_CANDIDATES) {
            val stream = openAsset(assetName) ?: continue
            stream.use { input ->
                dest.outputStream().use { output ->
                    input.copyTo(output)
                }
            }
            if (!dest.setExecutable(true, false) && !dest.canExecute()) {
                throw IllegalStateException("Unable to mark XMRig binary executable at ${dest.absolutePath}")
            }
            return dest
        }

        throw IllegalStateException(
            "XMRig binary not found. Build it with scripts/build_xmrig.sh " +
                "(expected $PACKAGED_NAME in jniLibs or assets/${ASSET_CANDIDATES.joinToString()})"
        )
    }

    companion object {
        const val PACKAGED_NAME = "libxmrig.so"
        const val EXTRACTED_NAME = "xmrig"
        val ASSET_CANDIDATES = listOf("xmrig_arm64", "xmrig", PACKAGED_NAME)
    }
}
