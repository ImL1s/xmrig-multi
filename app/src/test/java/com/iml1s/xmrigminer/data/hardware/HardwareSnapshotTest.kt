package com.iml1s.xmrigminer.data.hardware

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HardwareSnapshotTest {

    @Test
    fun `live probe keeps unknown memory as null not zero`() {
        val snap = HardwareProbe.captureLive(
            logicalProcessors = 8,
            totalMemoryBytes = null,
            availableMemoryBytes = null,
            abi = "arm64-v8a",
            nowIso = "2026-09-06T00:00:00.000Z"
        )
        assertEquals("live", snap.evidenceKind)
        assertNull(snap.memory.totalBytes.value)
        assertEquals("unknown", snap.memory.totalBytes.confidence)
        assertNull(snap.cpu.physical.value)
        assertEquals(8, snap.cpu.logical.value)
    }

    @Test
    fun `32-bit abi is marked unsupported`() {
        val snap = HardwareProbe.captureLive(
            logicalProcessors = 4,
            totalMemoryBytes = 2_000_000_000L,
            availableMemoryBytes = 500_000_000L,
            abi = "armeabi-v7a",
            nowIso = "2026-09-06T00:00:00.000Z"
        )
        assertEquals(false, snap.engine.abiSupported?.value)
        val rec = HardwareProbe.recommendThreads(snap)
        assertEquals(0, rec.recommendedThreads)
        assertTrue(rec.reasons.any { it.contains("ABI") })
    }

    @Test
    fun `recommender stays within logical and prefers light when memory low`() {
        val snap = HardwareProbe.captureLive(
            logicalProcessors = 1,
            totalMemoryBytes = 1_000_000_000L,
            availableMemoryBytes = 400_000_000L,
            abi = "arm64-v8a",
            nowIso = "2026-09-06T00:00:00.000Z"
        )
        val rec = HardwareProbe.recommendThreads(snap)
        assertEquals(1, rec.maxThreads)
        assertEquals(1, rec.recommendedThreads)
        assertEquals("light", rec.randomxModeHint)
        // allowed is assumed-all-logical with low confidence, but still a concrete set
        assertTrue(rec.affinitySafe || rec.maxThreads == 1)
    }
}
