package com.iml1s.xmrigminer.data.hardware

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AutoTuneServiceTest {

    private fun snap(logical: Int = 8, availableGiB: Long = 12): HardwareSnapshot {
        val ts = "2026-09-06T00:00:00Z"
        return HardwareSnapshot(
            capturedAt = ts,
            evidenceKind = "fixture",
            platform = HardwareSnapshot.Platform(os = "android", arch = "arm64"),
            cpu = HardwareSnapshot.Cpu(
                logical = HardwareSnapshot.known(logical, "fixture", "high", ts),
                physical = HardwareSnapshot.known(logical / 2, "fixture", "medium", ts),
                allowed = HardwareSnapshot.known(logical, "fixture", "high", ts)
            ),
            memory = HardwareSnapshot.Memory(
                totalBytes = HardwareSnapshot.known(availableGiB * 2 * 1024L * 1024 * 1024, "fixture", "high", ts),
                availableBytes = HardwareSnapshot.known(availableGiB * 1024L * 1024 * 1024, "fixture", "high", ts)
            )
        )
    }

    @Test
    fun `uncalibrated suggestion does not claim measured watts`() {
        val r = AutoTuneService.uncalibratedSuggestion(snap())
        assertEquals("idle", r.phase)
        assertFalse(r.claimsMeasuredHashesPerWatt)
        assertTrue(r.quietUsesLoadProxy)
        assertTrue(r.recommendation!!.threads >= 1)
    }

    @Test
    fun `locked threads produce single thread candidates`() {
        val c = AutoTuneService.buildSafeCandidates(
            snap(),
            lockedThreads = 3,
            lockedRandomxMode = "light"
        )
        assertTrue(c.isNotEmpty())
        assertTrue(c.all { it.threads == 3 && it.randomxMode == "light" })
    }

    @Test
    fun `accept refuses stale fingerprint`() {
        val snap = snap()
        val fp = AutoTuneService.fingerprint(snap, "build-a", "rx/0")
        val result = AutoTuneService.TuneResult(
            phase = "completed",
            ok = true,
            accepted = false,
            recommendation = AutoTuneService.Recommendation(4, "fast", "test", "medium"),
            fingerprintHash = fp,
            warnings = emptyList(),
            claimsMeasuredHashesPerWatt = false,
            claimsMeasuredQuiet = false,
            quietUsesLoadProxy = true,
            rollbackThreads = 2,
            rollbackRandomxMode = "light"
        )
        val (ok, _) = AutoTuneService.accept(result, fp)
        assertTrue(ok)
        val (stale, rec) = AutoTuneService.accept(result, "other")
        assertFalse(stale)
        assertEquals(null, rec)
    }
}
