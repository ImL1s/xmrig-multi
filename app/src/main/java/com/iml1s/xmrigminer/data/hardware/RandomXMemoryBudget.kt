package com.iml1s.xmrigminer.data.hardware

/**
 * RandomX memory budget (#35 / #129). Mirrors shared/randomx-memory.
 * Scratchpad ≠ full engine RAM; never label fast mode as "2 MB".
 *
 * Dataset MiB ceil comes from XMRig v6.21.0 RandomX_ConfigurationBase
 * (DatasetBaseSize + DatasetExtraSize ≈ 2080 MiB). RandomWOW inherits that
 * dataset; its 1 MiB value is per-thread scratchpad only.
 */
object RandomXMemoryBudget {
    const val MIB = 1024L * 1024L
    const val DEFAULT_APP_RESERVE_MIB = 256
    const val SOFT_BUDGET_FRACTION = 0.75
    const val ENGINE_VERSION = "6.21.0"
    /** DatasetBaseSize + DatasetExtraSize from xmrig v6.21.0 randomx.h */
    const val ENGINE_DATASET_BASE_PLUS_EXTRA_BYTES = 2147483648L + 33554368L
    const val ENGINE_DATASET_MIB = 2080

    data class Algorithm(
        val id: String,
        val displayName: String,
        val datasetMiB: Int?,
        val cacheMiB: Int,
        val scratchpadMiB: Int,
        val supportsFast: Boolean,
        val supportsLight: Boolean
    )

    val RX0 = Algorithm("rx/0", "RandomX", ENGINE_DATASET_MIB, 256, 2, true, true)
    val RX_WOW = Algorithm("rx/wow", "RandomWOW", ENGINE_DATASET_MIB, 256, 1, true, true)
    val ASTRO = Algorithm("astrobwt/v3", "AstroBWT/v3", null, 0, 20, false, false)

    data class Component(val name: String, val bytes: Long, val role: String)

    data class Estimate(
        val algorithm: String,
        val displayName: String,
        val requestedMode: String,
        val estimatedAsMode: String?,
        val threads: Int,
        val numaNodes: Int,
        val components: List<Component>,
        val miningBytes: Long,
        val totalEstimatedBytes: Long,
        val softBudgetBytes: Long?,
        val budgetBaseBytes: Long?,
        val fitsSoftBudget: Boolean?,
        val fitsHardLimit: Boolean?,
        val confidence: String,
        val warnings: List<String>
    )

    data class Selection(
        val ok: Boolean,
        val mode: String,
        val appliedMode: String?,
        val blocked: Boolean,
        val reasons: List<String>,
        val estimate: Estimate,
        val requiresSoftConfirm: Boolean,
        val fallbackApplied: Boolean,
        val retryHint: String?
    )

    fun resolveAlgorithm(coinOrAlgo: String): Algorithm {
        val s = coinOrAlgo.lowercase()
        return when {
            s == "rx/0" || s == "randomx" || s == "monero" || s == "xmr" || s == "MONERO".lowercase() -> RX0
            s == "rx/wow" || s.contains("wow") -> RX_WOW
            s.contains("astro") || s.contains("dero") -> ASTRO
            else -> RX0
        }
    }

    fun estimate(
        algorithm: String = "rx/0",
        mode: String = "auto",
        threads: Int = 1,
        numaNodes: Int = 1,
        availableBytes: Long? = null,
        totalBytes: Long? = null,
        processLimitBytes: Long? = null,
        appReserveMiB: Int = DEFAULT_APP_RESERVE_MIB
    ): Estimate {
        val algo = resolveAlgorithm(algorithm)
        val t = threads.coerceAtLeast(1)
        val numa = numaNodes.coerceAtLeast(1)
        val modeReq = normalizeMode(mode)

        if (algo.id == ASTRO.id) {
            val scratch = algo.scratchpadMiB * MIB * t
            val app = appReserveMiB.coerceAtLeast(0) * MIB
            return Estimate(
                algorithm = algo.id,
                displayName = algo.displayName,
                requestedMode = modeReq,
                estimatedAsMode = null,
                threads = t,
                numaNodes = 1,
                components = listOf(
                    Component("scratchpad", scratch, "Non-RandomX working set estimate"),
                    Component("app-reserve", app, "Application / OS soft reserve")
                ),
                miningBytes = scratch,
                totalEstimatedBytes = scratch + app,
                softBudgetBytes = null,
                budgetBaseBytes = availableBytes ?: totalBytes,
                fitsSoftBudget = null,
                fitsHardLimit = null,
                confidence = "low",
                warnings = listOf("Not a RandomX algorithm — fast/light modes do not apply")
            )
        }

        val effective = if (modeReq == "auto") "fast" else modeReq
        val components = mutableListOf<Component>()
        val cacheBytes = algo.cacheMiB * MIB
        components += Component(
            "cpu-cache",
            cacheBytes,
            "RandomX cache (≈256 MiB first node; light mode working set)"
        )
        var datasetBytes = 0L
        if (effective == "fast" && algo.datasetMiB != null) {
            datasetBytes = algo.datasetMiB * MIB * numa
            components += Component(
                "dataset",
                datasetBytes,
                "Full dataset ≈${algo.datasetMiB} MiB × $numa NUMA node(s)"
            )
        }
        val scratchpadBytes = algo.scratchpadMiB * MIB * t
        components += Component(
            "scratchpad",
            scratchpadBytes,
            "Per-thread scratchpad ${algo.scratchpadMiB} MiB × $t workers (not total engine RAM)"
        )
        val appReserveBytes = appReserveMiB.coerceAtLeast(0) * MIB
        components += Component(
            "app-reserve",
            appReserveBytes,
            "Application / OS soft reserve kept out of mining budget"
        )

        val miningBytes = cacheBytes + datasetBytes + scratchpadBytes
        val totalEstimated = miningBytes + appReserveBytes
        // Soft budget uses available/total host RAM only — processLimit is the hard gate (#129).
        val budgetBase = listOfNotNull(availableBytes, totalBytes).minOrNull()
        val softBudget = budgetBase?.let { (it * SOFT_BUDGET_FRACTION).toLong() }
        val confidence = when {
            availableBytes != null -> "high"
            processLimitBytes != null || totalBytes != null -> "medium"
            else -> "unknown"
        }
        val warnings = mutableListOf<String>()
        if (availableBytes == null) {
            warnings += "Available RAM unknown — do not assume allocation will succeed after probe"
        }
        if (softBudget != null && totalEstimated > softBudget) {
            warnings += "Estimated use exceeds soft budget — prefer light or fewer threads"
        }
        if (datasetBytes > 0 && scratchpadBytes < datasetBytes / 100) {
            warnings +=
                "Scratchpad is only ${scratchpadBytes / MIB} MiB total — " +
                    "full dataset is ~${datasetBytes / MIB} MiB; UI must not label full mode as \"2 MB\""
        }

        return Estimate(
            algorithm = algo.id,
            displayName = algo.displayName,
            requestedMode = modeReq,
            estimatedAsMode = effective,
            threads = t,
            numaNodes = numa,
            components = components,
            miningBytes = miningBytes,
            totalEstimatedBytes = totalEstimated,
            softBudgetBytes = softBudget,
            budgetBaseBytes = budgetBase,
            fitsSoftBudget = softBudget?.let { totalEstimated <= it },
            fitsHardLimit = processLimitBytes?.let { miningBytes <= it },
            confidence = confidence,
            warnings = warnings
        )
    }

    fun select(
        algorithm: String = "rx/0",
        requestedMode: String = "auto",
        locked: Boolean = false,
        threads: Int = 1,
        numaNodes: Int = 1,
        availableBytes: Long? = null,
        totalBytes: Long? = null,
        processLimitBytes: Long? = null,
        confirmSoftOverride: Boolean = false,
        allocationFailed: Boolean = false
    ): Selection {
        val algo = resolveAlgorithm(algorithm)
        val requested = normalizeMode(requestedMode)
        val reasons = mutableListOf<String>()

        if (algo.id == ASTRO.id) {
            return Selection(
                ok = true,
                mode = "auto",
                appliedMode = null,
                blocked = false,
                reasons = listOf("RandomX mode N/A for this algorithm"),
                estimate = estimate(algorithm, requested, threads, numaNodes, availableBytes, totalBytes, processLimitBytes),
                requiresSoftConfirm = false,
                fallbackApplied = false,
                retryHint = null
            )
        }

        if (allocationFailed) {
            // OOM retry uses the same evaluate / hard-limit gate as first launch (#129).
            if (locked && requested == "fast") {
                val lightEst = estimate(algorithm, "light", threads, numaNodes, availableBytes, totalBytes, processLimitBytes)
                return Selection(
                    ok = false,
                    mode = requested,
                    appliedMode = null,
                    blocked = true,
                    reasons = listOf(
                        "Previous allocation failed; locked fast mode not auto-downgraded",
                        "Unlock or switch to light to retry with lower memory"
                    ),
                    estimate = lightEst,
                    requiresSoftConfirm = false,
                    fallbackApplied = false,
                    retryHint = "Switch to light mode and retry once — do not loop forever"
                )
            }
            reasons += "Previous allocation/OS pressure failure — evaluating light retry"
            val trial = evaluate(algo, "light", threads, numaNodes, availableBytes, totalBytes, processLimitBytes, reasons)
            val confirmedSoft = trial.requiresSoftConfirm && confirmSoftOverride && !trial.hardBlocked
            val permitted = trial.ok || confirmedSoft
            if (permitted && confirmedSoft) {
                reasons += "User confirmed soft-budget override for light retry"
            }
            return Selection(
                ok = permitted,
                mode = if (locked) requested else if (permitted) "light" else requested,
                appliedMode = if (permitted) "light" else null,
                blocked = !permitted,
                reasons = reasons + listOf(
                    if (permitted) "light retry permitted"
                    else "light retry blocked — free memory, lower threads, or device unsupported"
                ),
                estimate = trial.estimate,
                requiresSoftConfirm = !permitted && trial.requiresSoftConfirm,
                fallbackApplied = permitted && !locked,
                retryHint = if (permitted) "Retry light once after freeing memory"
                else "Free memory or lower threads — light also blocked by hard/soft gate"
            )
        }

        if (requested == "auto") {
            val fast = evaluate(algo, "fast", threads, numaNodes, availableBytes, totalBytes, processLimitBytes, reasons)
            if (fast.ok) {
                return Selection(true, "auto", "fast", false, reasons.toList(), fast.estimate, false, false, null)
            }
            val light = evaluate(algo, "light", threads, numaNodes, availableBytes, totalBytes, processLimitBytes, reasons)
            return Selection(
                ok = light.ok,
                mode = "auto",
                appliedMode = if (light.ok) "light" else null,
                blocked = !light.ok,
                reasons = reasons.toList(),
                estimate = light.estimate,
                requiresSoftConfirm = light.requiresSoftConfirm,
                fallbackApplied = light.ok,
                retryHint = if (light.ok) null else "Free memory or lower threads"
            )
        }

        val trial = evaluate(algo, requested, threads, numaNodes, availableBytes, totalBytes, processLimitBytes, reasons)
        if (trial.ok) {
            return Selection(true, requested, requested, false, reasons.toList(), trial.estimate, false, false, null)
        }
        if (trial.requiresSoftConfirm && confirmSoftOverride && !trial.hardBlocked) {
            reasons += "User confirmed soft-budget override"
            return Selection(true, requested, requested, false, reasons.toList(), trial.estimate, false, false, null)
        }
        if (locked) {
            return Selection(
                ok = false,
                mode = requested,
                appliedMode = null,
                blocked = true,
                reasons = reasons + listOf(
                    "Manual mode locked — not overwritten by auto fallback",
                    if (trial.hardBlocked) "Hard OS/process limit would be exceeded"
                    else "Soft budget exceeded — confirm override or unlock"
                ),
                estimate = trial.estimate,
                requiresSoftConfirm = trial.requiresSoftConfirm,
                fallbackApplied = false,
                retryHint = if (trial.hardBlocked) "Reduce threads or use light mode"
                else "Confirm soft override or switch to light"
            )
        }
        if (requested == "fast" && algo.supportsLight) {
            val light = evaluate(algo, "light", threads, numaNodes, availableBytes, totalBytes, processLimitBytes, reasons)
            if (light.ok) {
                reasons += "Fast blocked this session — applied light; permanent preference unchanged"
                return Selection(
                    true, "fast", "light", false, reasons.toList(), light.estimate,
                    false, true, "Restore fast when more RAM is available"
                )
            }
        }
        return Selection(
            false, requested, null, true, reasons.toList(), trial.estimate,
            trial.requiresSoftConfirm, false, "Free memory, lower threads, or use light mode"
        )
    }

    /** Honest config-screen copy — never "Full mode (2MB)". */
    @Suppress("UNUSED_PARAMETER")
    fun algorithmSummary(coinOrAlgo: String, mode: String = "auto", threads: Int = 1): Pair<String, String> {
        val algo = resolveAlgorithm(coinOrAlgo)
        if (algo.id == ASTRO.id) {
            return "${algo.displayName} — CPU optimized" to
                "Not RandomX; fast/light modes do not apply"
        }
        val modeLabel = when (normalizeMode(mode)) {
            "light" -> "light"
            "fast" -> "fast"
            else -> "auto (prefer fast if RAM allows)"
        }
        val title = "${algo.displayName} — $modeLabel"
        val detail =
            "Scratchpad ${algo.scratchpadMiB} MiB/thread · cache ~${algo.cacheMiB} MiB" +
                if (algo.datasetMiB != null) " · dataset ~${algo.datasetMiB} MiB/NUMA (fast)" else ""
        return title to detail
    }

    fun isMisleadingFullModeLabel(text: String): Boolean =
        Regex("""full\s*mode\s*\(\s*2\s*m""", RegexOption.IGNORE_CASE).containsMatchIn(text)

    private data class Eval(
        val ok: Boolean,
        val estimate: Estimate,
        val hardBlocked: Boolean,
        val requiresSoftConfirm: Boolean
    )

    private fun evaluate(
        algo: Algorithm,
        mode: String,
        threads: Int,
        numaNodes: Int,
        availableBytes: Long?,
        totalBytes: Long?,
        processLimitBytes: Long?,
        reasons: MutableList<String>
    ): Eval {
        val estimate = estimate(algo.id, mode, threads, numaNodes, availableBytes, totalBytes, processLimitBytes)
        if (mode == "fast" && !algo.supportsFast) {
            reasons += "${algo.displayName} fast mode unsupported"
            return Eval(false, estimate, true, false)
        }
        if (mode == "light" && !algo.supportsLight) {
            reasons += "${algo.displayName} light mode unsupported"
            return Eval(false, estimate, true, false)
        }
        if (estimate.fitsHardLimit == false) {
            reasons += "Hard process limit too low for $mode"
            return Eval(false, estimate, true, false)
        }
        if (estimate.softBudgetBytes == null) {
            return if (mode == "light") {
                reasons += "Memory unknown — light is the safe default"
                Eval(true, estimate, false, false)
            } else {
                reasons += "Memory unknown — fast not selected without soft confirmation"
                Eval(false, estimate, false, true)
            }
        }
        if (estimate.fitsSoftBudget == false) {
            reasons += "$mode estimate exceeds soft budget"
            return Eval(false, estimate, false, true)
        }
        reasons += "$mode fits soft budget (confidence=${estimate.confidence})"
        return Eval(true, estimate, false, false)
    }

    private fun normalizeMode(mode: String): String =
        when (mode.lowercase()) {
            "fast", "light", "auto" -> mode.lowercase()
            else -> "auto"
        }
}
