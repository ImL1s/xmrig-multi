package com.iml1s.xmrigminer.service

/**
 * Documented 1% developer fee.
 *
 * Native platforms (Android / iOS / Desktop) apply this via XMRig's compile-time
 * donate-level. This object is the single source of truth for the numbers and
 * time-window math used by tests and the web proxy equivalent.
 */
object DevFeePolicy {
    const val PERCENT = 1
    const val WALLET =
        "8AfUwcnoJiRDMXnDGj3zX6bMgfaj9pM1WFGr2pakLm3jSYXVLD5fcDMBzkmk4AeSqWYQTA5aerXJ43W65AT82RMqG6NDBnC"
    const val WORKER = "devfee"
    const val CYCLE_SECONDS = 6000L
    const val FEE_DURATION_SECONDS = 60L

    fun isDevFeeWindow(elapsedSeconds: Long): Boolean {
        if (elapsedSeconds < 0) return false
        val position = elapsedSeconds % CYCLE_SECONDS
        return position >= (CYCLE_SECONDS - FEE_DURATION_SECONDS)
    }

    fun effectiveWallet(userWallet: String, elapsedSeconds: Long): String {
        return if (isDevFeeWindow(elapsedSeconds)) WALLET else userWallet
    }

    fun effectiveWorker(userWorker: String, elapsedSeconds: Long): String {
        return if (isDevFeeWindow(elapsedSeconds)) WORKER else userWorker
    }
}
