package com.iml1s.xmrigminer.data.hardware

/**
 * Topology candidates + soft affinity policy for Android (#36).
 * Hard CPU affinity is not available without privileged APIs — candidates stay OS-auto.
 */
object CpuTopology {
    data class Candidate(
        val id: String,
        val label: String,
        val mode: String,
        val threads: Int,
        val cpuIds: List<Int>?,
        val groupKind: String?,
        val notes: List<String>
    )

    data class AffinityValidation(
        val ok: Boolean,
        val ids: List<Int>,
        val normalized: Boolean,
        val errors: List<String>,
        val warnings: List<String>
    )

    fun affinityModeForOs(os: String): String = when (os.lowercase()) {
        "linux", "windows" -> "hard"
        "macos", "darwin", "android", "ios" -> "soft"
        else -> "unsupported"
    }

    fun canEmitHardAffinity(os: String): Boolean = affinityModeForOs(os) == "hard"

    fun buildCandidates(snapshot: HardwareSnapshot): List<Candidate> {
        val os = snapshot.platform.os
        val hard = canEmitHardAffinity(os)
        val allowed = snapshot.cpu.allowed.value
            ?: snapshot.cpu.logical.value
            ?: 1
        val max = allowed.coerceAtLeast(1)
        val out = mutableListOf(
            Candidate(
                id = "os-auto",
                label = "OS scheduler (baseline)",
                mode = "os-auto",
                threads = max,
                cpuIds = null,
                groupKind = null,
                notes = listOf("No hard affinity; lets OS place workers")
            )
        )
        val physical = snapshot.cpu.physical.value
        if (physical != null && physical in 1 until max) {
            out += Candidate(
                id = "physical-count",
                label = "Prefer physical core count",
                mode = if (hard) "affinity" else "os-auto",
                threads = physical,
                cpuIds = null,
                groupKind = "physical",
                notes = listOf(
                    if (hard) "Thread count from physical cores"
                    else "Android: soft policy only — no hard bind"
                )
            )
        }
        if (!hard) {
            // Ensure we never advertise affinity mode on Android.
            return out.map { if (it.mode == "affinity") it.copy(mode = "os-auto", cpuIds = null) else it }
        }
        return out
    }

    fun validateCpuIds(
        logicalMax: Int,
        allowedIds: Set<Int>,
        input: List<Int>,
        allowNormalize: Boolean = true
    ): AffinityValidation {
        if (input.isEmpty()) {
            return AffinityValidation(false, emptyList(), false, listOf("empty affinity"), emptyList())
        }
        val errors = mutableListOf<String>()
        val warnings = mutableListOf<String>()
        val kept = linkedSetOf<Int>()
        for (id in input) {
            if (id < 0 || id >= logicalMax) {
                errors += "id $id out of range (logicalMax=$logicalMax)"
                continue
            }
            if (allowedIds.isNotEmpty() && id !in allowedIds) {
                errors += "cpu $id outside allowed cpuset"
                continue
            }
            kept += id
        }
        if (kept.isEmpty()) {
            return AffinityValidation(false, emptyList(), false, errors.ifEmpty { listOf("no valid cpu ids") }, warnings)
        }
        if (errors.isNotEmpty() && !allowNormalize) {
            return AffinityValidation(false, emptyList(), false, errors, warnings)
        }
        if (errors.isNotEmpty()) {
            warnings += "normalized: dropped invalid ids (${errors.joinToString("; ")})"
            return AffinityValidation(true, kept.toList(), true, emptyList(), warnings)
        }
        val hadDupes = input.size != kept.size
        if (hadDupes) warnings += "duplicate cpu ids removed"
        return AffinityValidation(true, kept.toList(), false, emptyList(), warnings)
    }
}
