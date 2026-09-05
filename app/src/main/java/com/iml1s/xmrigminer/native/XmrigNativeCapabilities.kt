package com.iml1s.xmrigminer.native

/**
 * Compile-time features of the packaged Android XMRig (`scripts/build_xmrig.sh`).
 * Keep these in sync with that script's CMake flags.
 */
object XmrigNativeCapabilities {
    const val TLS_ENABLED = false
    const val TLS_UNSUPPORTED_MESSAGE =
        "此 Android 礦機未編譯 TLS，請關閉 Use TLS/SSL 並使用非 SSL 礦池埠"
}
