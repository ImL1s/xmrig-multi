package com.iml1s.xmrigminer.data.hardware

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CpuTopologyTest {

    @Test
    fun `android candidates stay soft os-auto`() {
        val snap = HardwareProbe.captureLive(
            logicalProcessors = 8,
            totalMemoryBytes = 4_000_000_000L,
            availableMemoryBytes = 2_000_000_000L,
            abi = "arm64-v8a",
            nowIso = "2026-09-06T00:00:00.000Z"
        )
        val candidates = CpuTopology.buildCandidates(snap)
        assertEquals("os-auto", candidates.first().id)
        assertTrue(candidates.none { it.mode == "affinity" })
        assertEquals("soft", CpuTopology.affinityModeForOs("android"))
        assertFalse(CpuTopology.canEmitHardAffinity("android"))
    }

    @Test
    fun `validateCpuIds normalizes oob and rejects empty`() {
        val empty = CpuTopology.validateCpuIds(8, (0 until 8).toSet(), emptyList())
        assertFalse(empty.ok)

        val normalized = CpuTopology.validateCpuIds(
            logicalMax = 8,
            allowedIds = (0 until 8).toSet(),
            input = listOf(0, 1, 99, 4, 0),
            allowNormalize = true
        )
        assertTrue(normalized.ok)
        assertTrue(normalized.normalized)
        assertEquals(listOf(0, 1, 4), normalized.ids)
    }
}
