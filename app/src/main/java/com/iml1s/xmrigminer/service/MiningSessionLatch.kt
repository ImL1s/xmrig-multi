package com.iml1s.xmrigminer.service

/**
 * Shared Stop latch visible to DreamService and other entry points (#76/#73/#39).
 */
object MiningSessionLatch {
    @Volatile
    var userStopRevision: Int = 0
        private set

    @Volatile
    var sessionArmedRevision: Int = 0
        private set

    fun latchUserStop() {
        userStopRevision += 1
    }

    fun armSession() {
        sessionArmedRevision = userStopRevision
    }

    fun isUserStopped(): Boolean = userStopRevision > sessionArmedRevision
}
