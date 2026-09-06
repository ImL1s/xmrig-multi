package com.iml1s.xmrigminer.service.quick

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QuickCommandProtocolTest {

    @Test
    fun stopLatchedBlocksStart() {
        val cmd = QuickCommand(
            commandId = "1",
            type = "start_profile",
            issuedAtMs = 1000,
            expiresAtMs = 2000
        )
        val ack = QuickCommandProtocol.receive(
            command = cmd,
            nowMs = 1500,
            authorized = true,
            userStopLatched = true,
            osStartAllowed = true,
            missingProfile = false,
            sessionId = null
        )
        assertEquals("rejected", ack.ack)
        assertFalse(ack.apply)
    }

    @Test
    fun expiredCommandRejected() {
        val cmd = QuickCommand(
            commandId = "2",
            type = "stop_mining",
            issuedAtMs = 1000,
            expiresAtMs = 1100
        )
        val ack = QuickCommandProtocol.receive(
            command = cmd,
            nowMs = 2000,
            authorized = true,
            userStopLatched = false,
            osStartAllowed = true,
            missingProfile = false,
            sessionId = null
        )
        assertEquals("expired", ack.ack)
    }

    @Test
    fun newerStopBeatsOlderStart() {
        val start = QuickCommand("a", "start_profile", issuedAtMs = 1, expiresAtMs = 999)
        val stop = QuickCommand("b", "stop_mining", issuedAtMs = 2, expiresAtMs = 999)
        val effective = QuickCommandProtocol.effectiveCommand(listOf(stop, start))
        assertEquals("stop_mining", effective?.type)
    }

    @Test
    fun pauseResumeCancelledByNewerStop() {
        val blocked = QuickCommandProtocol.mayResumeAfterPause(
            stopRevisionAtPause = 1,
            currentStopRevision = 2,
            resumeAtMs = 100,
            nowMs = 200,
            userStopLatched = false,
            osStartAllowed = true,
            budgetBlocked = false,
            powerBlocked = false
        )
        assertFalse(blocked.apply)
        val ok = QuickCommandProtocol.mayResumeAfterPause(
            stopRevisionAtPause = 1,
            currentStopRevision = 1,
            resumeAtMs = 100,
            nowMs = 200,
            userStopLatched = false,
            osStartAllowed = true,
            budgetBlocked = false,
            powerBlocked = false
        )
        assertTrue(ok.apply)
    }

    @Test
    fun unauthorizedRejected() {
        val cmd = QuickCommand("x", "start_profile", issuedAtMs = 1, expiresAtMs = 999)
        val ack = QuickCommandProtocol.receive(
            cmd, 1, authorized = false, userStopLatched = false,
            osStartAllowed = true, missingProfile = false, sessionId = null
        )
        assertEquals("rejected", ack.ack)
    }
}
