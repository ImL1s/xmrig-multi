package com.iml1s.xmrigminer.data.hardware

/**
 * Cross-platform HardwareSnapshot v1 facts (#33).
 * Mirrors shared/hardware-capability/schema/hardware-snapshot.schema.json.
 * Unknown sensors/memory stay null — never invent 0.
 */
data class HardwareSnapshot(
    val schemaVersion: Int = SCHEMA_VERSION,
    val capturedAt: String,
    val evidenceKind: String,
    val platform: Platform,
    val cpu: Cpu,
    val memory: Memory,
    val power: Power = Power(),
    val sensors: Sensors = Sensors(),
    val engine: Engine = Engine(),
    val invalidationHints: List<String> = listOf(
        "cpuset-change",
        "hotplug",
        "power-source-change",
        "memory-pressure"
    )
) {
    data class Field<T>(
        val value: T?,
        val source: String,
        val timestamp: String,
        val confidence: String,
        val unknownReason: String? = null
    )

    data class Platform(
        val os: String,
        val arch: String,
        val osVersion: Field<String>? = null,
        val abi: Field<String>? = null,
        val containerOrVm: Field<Boolean>? = null
    )

    data class Cpu(
        val logical: Field<Int>,
        val physical: Field<Int>,
        val allowed: Field<Int>,
        val name: Field<String>? = null,
        val smt: Field<Boolean>? = null,
        val heterogeneous: Field<Boolean>? = null
    )

    data class Memory(
        val totalBytes: Field<Long>,
        val availableBytes: Field<Long>,
        val processLimitBytes: Field<Long>? = null
    )

    data class Power(
        val onAc: Field<Boolean>? = null,
        val batteryPresent: Field<Boolean>? = null
    )

    data class Sensors(
        val thermalReadable: Field<Boolean>? = null,
        val powerReadable: Field<Boolean>? = null
    )

    data class Engine(
        val abiSupported: Field<Boolean>? = null,
        val flags: List<String> = emptyList()
    )

    companion object {
        const val SCHEMA_VERSION = 1

        fun <T> known(value: T, source: String, confidence: String, ts: String): Field<T> =
            Field(value, source, ts, confidence, null)

        fun <T> unknown(source: String, reason: String, ts: String): Field<T> =
            Field(null, source, ts, "unknown", reason)
    }
}

object HardwareProbe {
    /**
     * Live Android probe using public APIs only — no root.
     * Topology beyond logical count stays unknown with reasons.
     */
    fun captureLive(
        logicalProcessors: Int,
        totalMemoryBytes: Long?,
        availableMemoryBytes: Long?,
        abi: String,
        arch: String = abi,
        onAc: Boolean? = null,
        batteryPresent: Boolean? = null,
        nowIso: String
    ): HardwareSnapshot {
        val logical = logicalProcessors.coerceAtLeast(1)
        val abiSupported = abi.contains("64") || abi.contains("arm64") || abi.contains("x86_64")
        return HardwareSnapshot(
            capturedAt = nowIso,
            evidenceKind = "live",
            platform = HardwareSnapshot.Platform(
                os = "android",
                arch = arch,
                osVersion = HardwareSnapshot.unknown("Build.VERSION", "caller-omitted", nowIso),
                abi = HardwareSnapshot.known(abi, "Build.SUPPORTED_ABIS", "high", nowIso),
                containerOrVm = HardwareSnapshot.known(false, "android-app", "medium", nowIso)
            ),
            cpu = HardwareSnapshot.Cpu(
                name = HardwareSnapshot.unknown("cpuinfo", "not-probed", nowIso),
                logical = HardwareSnapshot.known(logical, "Runtime.availableProcessors", "high", nowIso),
                physical = HardwareSnapshot.unknown("topology", "not-exposed", nowIso),
                allowed = HardwareSnapshot.known(logical, "assume-all-logical", "low", nowIso),
                smt = HardwareSnapshot.unknown("topology", "not-exposed", nowIso),
                heterogeneous = HardwareSnapshot.unknown("topology", "not-exposed", nowIso)
            ),
            memory = HardwareSnapshot.Memory(
                totalBytes = totalMemoryBytes?.let {
                    HardwareSnapshot.known(it, "ActivityManager.MemoryInfo", "high", nowIso)
                } ?: HardwareSnapshot.unknown("ActivityManager.MemoryInfo", "unavailable", nowIso),
                availableBytes = availableMemoryBytes?.let {
                    HardwareSnapshot.known(it, "ActivityManager.MemoryInfo", "medium", nowIso)
                } ?: HardwareSnapshot.unknown("ActivityManager.MemoryInfo", "unavailable", nowIso),
                processLimitBytes = HardwareSnapshot.unknown("runtime", "not-probed", nowIso)
            ),
            power = HardwareSnapshot.Power(
                onAc = onAc?.let { HardwareSnapshot.known(it, "BatteryManager", "high", nowIso) }
                    ?: HardwareSnapshot.unknown("BatteryManager", "not-probed", nowIso),
                batteryPresent = batteryPresent?.let {
                    HardwareSnapshot.known(it, "BatteryManager", "medium", nowIso)
                } ?: HardwareSnapshot.unknown("BatteryManager", "not-probed", nowIso)
            ),
            sensors = HardwareSnapshot.Sensors(
                thermalReadable = HardwareSnapshot.known(false, "capability", "low", nowIso),
                powerReadable = HardwareSnapshot.known(false, "capability", "low", nowIso)
            ),
            engine = HardwareSnapshot.Engine(
                abiSupported = HardwareSnapshot.known(abiSupported, "abi-gate", "high", nowIso),
                flags = listOf("android-live-probe")
            )
        )
    }

    /**
     * Conservative thread suggestion from a snapshot (mirrors shared recommend.js).
     */
    fun recommendThreads(snapshot: HardwareSnapshot): RecommendedHardware {
        val abiOk = snapshot.engine.abiSupported?.value != false
        if (!abiOk) {
            return RecommendedHardware(
                recommendedThreads = 0,
                maxThreads = 0,
                randomxModeHint = "light",
                confidence = "high",
                reasons = listOf("ABI unsupported for bundled engine"),
                affinitySafe = false
            )
        }
        val allowed = snapshot.cpu.allowed.value
        val logical = snapshot.cpu.logical.value
        val max = when {
            allowed != null && allowed >= 1 -> allowed
            logical != null && logical >= 1 -> logical
            else -> 1
        }
        val recommended = if (max >= 2) max - 1 else 1
        val memAvail = snapshot.memory.availableBytes.value
        val memTotal = snapshot.memory.totalBytes.value
        val sel = RandomXMemoryBudget.select(
            algorithm = "rx/0",
            requestedMode = "auto",
            threads = recommended,
            availableBytes = memAvail,
            totalBytes = memTotal,
            processLimitBytes = snapshot.memory.processLimitBytes?.value
        )
        // Hint stays "auto" when fast fits so XMRig may still autoconfig; else "light".
        val rx = when (sel.appliedMode) {
            "fast" -> "auto"
            "light" -> "light"
            else -> "light"
        }
        val reasons = mutableListOf<String>()
        if (allowed != null) reasons.add("cap to allowed CPUs ($allowed)")
        else reasons.add("allowed unknown — using logical")
        reasons.addAll(sel.reasons.take(3))
        if (memAvail == null && memTotal == null) {
            reasons.add("memory unknown — prefer RandomX light (#35)")
        }
        return RecommendedHardware(
            recommendedThreads = recommended,
            maxThreads = max,
            randomxModeHint = rx,
            confidence = snapshot.cpu.logical.confidence,
            reasons = reasons,
            affinitySafe = allowed != null && snapshot.cpu.allowed.confidence != "unknown"
        )
    }
}

data class RecommendedHardware(
    val recommendedThreads: Int,
    val maxThreads: Int,
    val randomxModeHint: String,
    val confidence: String,
    val reasons: List<String>,
    val affinitySafe: Boolean
)
