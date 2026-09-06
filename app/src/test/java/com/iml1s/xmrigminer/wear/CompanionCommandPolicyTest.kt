package com.iml1s.xmrigminer.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CompanionCommandPolicyTest {

    private val t0 = 1_000_000L

    @Test
    fun `offline and stale never show as live`() {
        val offline = CompanionCommandPolicy.classifySync(
            paired = true,
            reachable = false,
            lastSyncAtMs = t0,
            nowMs = t0
        )
        assertEquals(CompanionCommandPolicy.SyncQuality.OFFLINE, offline.quality)
        assertFalse(offline.showAsLive)

        val stale = CompanionCommandPolicy.classifySync(
            paired = true,
            reachable = true,
            lastSyncAtMs = t0,
            nowMs = t0 + CompanionCommandPolicy.DEFAULT_STALE_AFTER_MS + 1
        )
        assertEquals(CompanionCommandPolicy.SyncQuality.STALE, stale.quality)
        assertFalse(stale.showAsLive)
    }

    @Test
    fun `expired and thermal rejected stop accepted`() {
        val start = CompanionCommandPolicy.Command(
            commandId = "c1",
            type = "start",
            targetDeviceId = "phone",
            sessionId = "s1",
            issuedAtMs = t0,
            expiresAtMs = t0 + 100
        )
        assertEquals(
            CompanionCommandPolicy.Ack.EXPIRED,
            CompanionCommandPolicy.receive(
                start, t0 + 200, paired = true, authenticated = true, reachable = true,
                phoneSessionId = "s1"
            ).ack
        )
        assertFalse(
            CompanionCommandPolicy.receive(
                start.copy(expiresAtMs = t0 + 10_000),
                t0,
                paired = true,
                authenticated = true,
                reachable = true,
                phoneSessionId = "s1",
                thermalBlocked = true
            ).apply
        )
        val stop = start.copy(commandId = "c2", type = "stop", expiresAtMs = t0 + 10_000)
        assertTrue(
            CompanionCommandPolicy.receive(
                stop, t0, paired = true, authenticated = true, reachable = true, phoneSessionId = "s1"
            ).apply
        )
    }

    @Test
    fun `newer stop beats older start duplicates ignored`() {
        val start = CompanionCommandPolicy.Command("a", "start", "p", null, "s", t0, t0 + 60_000)
        val stop = CompanionCommandPolicy.Command("b", "stop", "p", null, "s", t0 + 50, t0 + 60_000)
        val effective = CompanionCommandPolicy.effectiveCommand(listOf(start, stop, stop))
        assertEquals("stop", effective?.type)
        assertEquals("b", effective?.commandId)
    }

    @Test
    fun `secret keys detected for watch payload scrubbing`() {
        assertTrue(CompanionCommandPolicy.containsSecretKey("walletAddress"))
        assertTrue(CompanionCommandPolicy.containsSecretKey("apiToken"))
        assertFalse(CompanionCommandPolicy.containsSecretKey("hashrate"))
    }
}
