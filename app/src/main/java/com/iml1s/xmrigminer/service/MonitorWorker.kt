package com.iml1s.xmrigminer.service

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.iml1s.xmrigminer.data.daemon.DaemonEndpointParser
import com.iml1s.xmrigminer.data.daemon.DaemonRpcProbe
import com.iml1s.xmrigminer.data.model.MiningConfig
import com.iml1s.xmrigminer.data.network.ReconnectPolicy
import com.iml1s.xmrigminer.data.repository.StatsRepository
import com.iml1s.xmrigminer.util.CpuMonitor
import com.iml1s.xmrigminer.util.NetworkMonitor
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import timber.log.Timber

/**
 * One-shot worker that polls device health while mining is active.
 * Cancelled together with [MiningWorker]; cancellation runs MiningWorker's finally block
 * which destroys the XMRig process.
 *
 * Thermal (#38) and power (#39) policies drive pause/throttle decisions.
 */
@HiltWorker
class MonitorWorker @AssistedInject constructor(
    @Assisted private val context: Context,
    @Assisted params: WorkerParameters,
    private val statsRepository: StatsRepository,
    private val miningController: MiningController,
    private val networkMonitor: NetworkMonitor
) : CoroutineWorker(context, params) {

    companion object {
        const val WORK_NAME = "monitor_work"
        const val KEY_SOLO_DAEMON = "solo_daemon"
        const val KEY_SESSION_GENERATION = "session_generation"
        const val CHECK_INTERVAL = 5000L
        private const val DAEMON_PROBE_TIMEOUT_MS = 1500
    }

    private val cpuMonitor = CpuMonitor()
    private val launchConfig: MiningConfig? by lazy {
        val snapshot = inputData.getString(MiningWorker.KEY_CONFIG_SNAPSHOT) ?: return@lazy null
        runCatching { Json.decodeFromString(MiningConfig.serializer(), snapshot) }.getOrNull()
    }
    private val soloDaemonAtLaunch: Boolean by lazy {
        inputData.getBoolean(KEY_SOLO_DAEMON, false)
    }
    private val sessionGenerationAtLaunch: Long by lazy {
        inputData.getLong(KEY_SESSION_GENERATION, 0L)
    }

    private var thermalState = ThermalPolicy.State(
        phase = ThermalPolicy.Phase.ALLOWED,
        sinceMs = System.currentTimeMillis(),
        permanentThreads = null
    )
    private var powerIntent = PowerPolicy.armSession(PowerPolicy.Intent())
    private var lastSoftThrottleNotifyMs = 0L
    /** Dedicated clock for PENDING soft-throttle timeout (not shared with 60s hold logs). */
    private var softThrottlePendingSinceMs = 0L
    private var lastAppliedSoftThreads: Int? = null
    private var softThrottlePending = false

    override suspend fun doWork(): Result {
        Timber.i("MonitorWorker started")
        thermalState = thermalState.copy(
            permanentThreads = launchConfig?.threads,
            sinceMs = System.currentTimeMillis()
        )
        try {
            while (!isStopped) {
                updateBatteryStats()
                updateThermalStats()
                updateCpuStats()
                checkCriticalConditions()
                delay(CHECK_INTERVAL)
            }
            return Result.success()
        } catch (e: Exception) {
            Timber.e(e, "MonitorWorker failed")
            return Result.retry()
        }
    }

    private fun updateBatteryStats() {
        try {
            val batteryManager = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
            val level = batteryManager?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: 100
            statsRepository.updateBatteryLevel(level)
            statsRepository.updateChargingState(isEffectivelyPlugged())
        } catch (e: Exception) {
            Timber.w(e, "Failed to update battery stats")
        }
    }

    private fun updateThermalStats() {
        try {
            val reading = readBatteryTemperature()
            // Never invent healthy 0°C for unknown/sentinel (#125).
            val temp = reading.tempC
            if (temp != null && !(reading.suspectZero && temp == 0f)) {
                statsRepository.updateTemperature(temp)
            }
        } catch (e: Exception) {
            Timber.w(e, "Failed to update thermal stats")
        }
    }

    private fun updateCpuStats() {
        try {
            val cpuUsage = cpuMonitor.getCurrentUsage()
            if (cpuUsage > 0) {
                statsRepository.updateCpuUsage(cpuUsage)
            }
        } catch (e: Exception) {
            Timber.w(e, "Failed to update CPU stats")
        }
    }

    private suspend fun checkCriticalConditions() {
        val now = System.currentTimeMillis()
        val battIntent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val powerObs = buildPowerObservation(battIntent, now)
        val thermalObs = buildThermalObservation(battIntent, now)

        val thermalDecision = ThermalPolicy.evaluate(
            observations = listOf(thermalObs),
            state = thermalState,
            nowMs = now,
            userStopped = MiningSessionLatch.isUserStopped()
        )
        thermalState = thermalDecision.nextState

        when (thermalDecision.phase) {
            ThermalPolicy.Phase.CRITICAL, ThermalPolicy.Phase.PAUSED -> {
                val reason = thermalDecision.reasons.firstOrNull()
                    ?: "Thermal policy pause"
                pauseMining(reason, code = "thermal")
                return
            }
            ThermalPolicy.Phase.SOFT_THROTTLE -> {
                val requested = thermalDecision.effectiveThreads
                val currentGen = miningController.currentSessionGeneration()
                if (currentGen != sessionGenerationAtLaunch) {
                    Timber.w(
                        "Ignore stale soft-throttle tick gen=%s launch=%s",
                        currentGen,
                        sessionGenerationAtLaunch
                    )
                } else if (thermalDecision.action == ThermalPolicy.Action.THROTTLE &&
                    requested != null &&
                    requested != lastAppliedSoftThreads
                ) {
                    softThrottlePending = true
                    if (softThrottlePendingSinceMs == 0L) softThrottlePendingSinceMs = now
                    if (requested <= 0) {
                        softThrottlePending = false
                        softThrottlePendingSinceMs = 0L
                        pauseMining("Invalid throttle threads", code = "thermal_throttle")
                        return
                    }
                    val permanent = thermalState.permanentThreads
                    if (permanent != null && requested >= permanent) {
                        softThrottlePending = false
                        softThrottlePendingSinceMs = 0L
                    } else {
                        val enqueued = miningController.requestRuntimeThreadOverride(
                            requested,
                            thermalDecision.reasons.firstOrNull() ?: "soft throttle"
                        )
                        if (enqueued == null) {
                            softThrottlePending = false
                            softThrottlePendingSinceMs = 0L
                            pauseMining(
                                "Engine could not enqueue soft throttle — pausing safely",
                                code = "thermal_throttle"
                            )
                            return
                        }
                        // PENDING until WorkManager reports active worker (#125).
                        val verified = miningController.verifyRuntimeThreadOverride(enqueued)
                        if (verified) {
                            lastAppliedSoftThreads = enqueued
                            softThrottlePending = false
                            softThrottlePendingSinceMs = 0L
                            thermalState = thermalState.copy(effectiveThreads = enqueued)
                            com.iml1s.xmrigminer.util.NotificationHelper.showWarning(
                                context,
                                "Thermal throttle applied: $enqueued threads"
                            )
                            lastSoftThrottleNotifyMs = now
                        } else {
                            Timber.i("Thermal throttle PENDING worker readback for %s threads", enqueued)
                            if (now - softThrottlePendingSinceMs > 15_000L) {
                                softThrottlePending = false
                                softThrottlePendingSinceMs = 0L
                                pauseMining(
                                    "Thermal throttle timeout — worker not active",
                                    code = "thermal_throttle"
                                )
                                return
                            }
                        }
                    }
                } else if (now - lastSoftThrottleNotifyMs > 60_000L) {
                    lastSoftThrottleNotifyMs = now
                    val status = when {
                        softThrottlePending -> "pending"
                        lastAppliedSoftThreads != null -> "applied ${lastAppliedSoftThreads}"
                        else -> "not applied"
                    }
                    Timber.w(
                        "Thermal soft throttle hold (%s) permanent=%s",
                        status,
                        thermalState.permanentThreads
                    )
                }
            }
            ThermalPolicy.Phase.ALLOWED -> {
                if (thermalDecision.action == ThermalPolicy.Action.RESUME &&
                    lastAppliedSoftThreads != null &&
                    miningController.currentSessionGeneration() == sessionGenerationAtLaunch
                ) {
                    val target = thermalState.permanentThreads
                    if (target == null) {
                        lastAppliedSoftThreads = null
                        softThrottlePending = false
                        softThrottlePendingSinceMs = 0L
                    } else {
                        softThrottlePending = true
                        if (softThrottlePendingSinceMs == 0L) softThrottlePendingSinceMs = now
                        val enqueued = miningController.requestClearRuntimeThreadOverride("thermal resume")
                        if (enqueued == null) {
                            softThrottlePending = false
                            softThrottlePendingSinceMs = 0L
                            pauseMining("Failed to restore permanent threads", code = "thermal_resume")
                            return
                        }
                        if (miningController.verifyRuntimeThreadOverride(enqueued)) {
                            lastAppliedSoftThreads = null
                            softThrottlePending = false
                            softThrottlePendingSinceMs = 0L
                        } else {
                            Timber.i("Thermal resume PENDING worker readback")
                            if (now - softThrottlePendingSinceMs > 15_000L) {
                                softThrottlePending = false
                                softThrottlePendingSinceMs = 0L
                                pauseMining(
                                    "Thermal resume timeout — worker not active",
                                    code = "thermal_resume"
                                )
                                return
                            }
                        }
                    }
                }
            }
        }

        val powerConfig = launchConfig?.let { miningController.powerDefaultsFrom(it) }
            ?: androidRuntimePowerDefaults()
        val powerVerdict = PowerPolicy.evaluate(
            observation = powerObs,
            intent = powerIntent,
            config = powerConfig,
            nowMs = now
        )
        powerIntent = powerVerdict.nextIntent

        when (powerVerdict.kind) {
            PowerPolicy.Kind.USER_STOPPED,
            PowerPolicy.Kind.PAUSED -> {
                val reason = powerVerdict.reasons.firstOrNull() ?: "Power policy pause"
                pauseMining(reason, code = "battery")
                return
            }
            PowerPolicy.Kind.WAITING -> {
                // Charge-to-target / schedule wait — pause session, keep stats (#39).
                val reason = powerVerdict.reasons.firstOrNull() ?: "Power policy waiting"
                pauseMining(reason, code = "battery")
                return
            }
            PowerPolicy.Kind.UNAVAILABLE -> {
                Timber.w("Power policy unavailable: %s", powerVerdict.reasons)
            }
            PowerPolicy.Kind.ALLOWED -> Unit
        }

        // Launch-time solo snapshot (#15 / Codex P2): do not re-read DataStore mid-run.
        val networkOk = if (soloDaemonAtLaunch) {
            daemonStillReachable(launchConfig?.poolUrl)
        } else {
            networkMonitor.isConnected()
        }
        if (!networkOk) {
            val reason = if (soloDaemonAtLaunch) {
                "Daemon unreachable or not ready"
            } else {
                "No network connection"
            }
            val cfg = launchConfig
            val classification = ReconnectPolicy.classify(
                code = "network",
                message = reason
            )
            val auto = cfg?.autoReconnect ?: true
            if (!auto || classification.kind != ReconnectPolicy.Kind.RETRYABLE) {
                pauseMining(reason, code = classification.code)
            } else {
                Timber.w(
                    "Transient network loss (%s); autoReconnect=true — not stopping session (#43)",
                    reason
                )
                com.iml1s.xmrigminer.util.NotificationHelper.showWarning(
                    context,
                    "$reason — reconnecting…"
                )
            }
        }
    }

    private fun buildThermalObservation(intent: Intent?, nowMs: Long): ThermalPolicy.Observation {
        if (intent == null) {
            return ThermalPolicy.Observation(
                source = ThermalPolicy.Source.BATTERY,
                celsius = null,
                timestampMs = nowMs,
                quality = ThermalPolicy.Quality.UNKNOWN,
                note = "Battery intent unavailable"
            )
        }
        val hasTemp = intent.hasExtra(BatteryManager.EXTRA_TEMPERATURE)
        val raw = intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE)
        if (!hasTemp || raw == Int.MIN_VALUE) {
            return ThermalPolicy.normalizeBatteryTemp(
                rawCelsius = null,
                timestampMs = nowMs,
                nowMs = nowMs,
                suspectZero = true
            )
        }
        val tempC = raw / 10f
        return ThermalPolicy.normalizeBatteryTemp(
            rawCelsius = tempC,
            timestampMs = nowMs,
            nowMs = nowMs,
            suspectZero = tempC == 0f && raw == 0
        )
    }

    private fun buildPowerObservation(intent: Intent?, nowMs: Long): PowerPolicy.Observation {
        if (intent == null) {
            return PowerPolicy.Observation(
                quality = PowerPolicy.Quality.FAILED,
                note = "Battery intent unavailable",
                timestampMs = nowMs
            )
        }
        val status = when (intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)) {
            BatteryManager.BATTERY_STATUS_CHARGING -> PowerPolicy.ChargingStatus.CHARGING
            BatteryManager.BATTERY_STATUS_FULL -> PowerPolicy.ChargingStatus.FULL
            BatteryManager.BATTERY_STATUS_NOT_CHARGING -> PowerPolicy.ChargingStatus.NOT_CHARGING
            BatteryManager.BATTERY_STATUS_DISCHARGING -> PowerPolicy.ChargingStatus.DISCHARGING
            else -> PowerPolicy.ChargingStatus.UNKNOWN
        }
        val pluggedFlag = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)
        val externalPower = pluggedFlag != 0
        val source = when (pluggedFlag) {
            BatteryManager.BATTERY_PLUGGED_AC -> PowerPolicy.PowerSource.AC
            BatteryManager.BATTERY_PLUGGED_USB -> PowerPolicy.PowerSource.USB
            BatteryManager.BATTERY_PLUGGED_WIRELESS -> PowerPolicy.PowerSource.WIRELESS
            0 -> null
            else -> PowerPolicy.PowerSource.UNKNOWN
        }
        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100).coerceAtLeast(1)
        val soc = if (level >= 0) ((level * 100f) / scale).toInt().coerceIn(0, 100) else null

        val batteryManager = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        val currentUa = batteryManager?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW)
        // Int.MIN_VALUE is the Android "unsupported" sentinel — never treat as real flow (#125).
        val flowMa = when {
            currentUa == null || currentUa == Int.MIN_VALUE -> null
            else -> currentUa / 1000
        }

        return PowerPolicy.Observation(
            platformHasBattery = true,
            batteryApiAvailable = true,
            externalPowerPresent = externalPower,
            powerSource = source,
            chargingStatus = status,
            socPercent = soc,
            netBatteryFlowMa = flowMa,
            quality = PowerPolicy.Quality.OK,
            timestampMs = nowMs
        )
    }

    private fun readBatteryTemperature(): TempReading {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            ?: return TempReading(null, suspectZero = true)
        if (!intent.hasExtra(BatteryManager.EXTRA_TEMPERATURE)) {
            return TempReading(null, suspectZero = true)
        }
        val raw = intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0)
        return TempReading(raw / 10f, suspectZero = raw == 0)
    }

    private fun isEffectivelyPlugged(): Boolean {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            ?: return false
        return intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
    }

    /**
     * Mid-run check: require parseable endpoint + successful get_info readiness.
     * Syncing mid-run is tolerated; hard RPC/TCP failures are not (#44).
     */
    private suspend fun daemonStillReachable(poolUrl: String?): Boolean {
        if (poolUrl.isNullOrBlank()) return false
        val parsed = DaemonEndpointParser.parse(poolUrl, allowHttps = false)
        if (!parsed.ok) return false
        val probe = DaemonRpcProbe.probe(poolUrl, timeoutMs = DAEMON_PROBE_TIMEOUT_MS)
        if (!probe.ok && probe.stage in setOf("dns", "tcp", "rpc_version", "tls")) {
            Timber.d("Solo daemon mid-run probe failed stage=%s code=%s", probe.stage, probe.code)
            return false
        }
        return probe.readyToMine || probe.code == "syncing"
    }

    private suspend fun pauseMining(reason: String, code: String? = null) {
        Timber.w("Pausing mining: $reason (code=%s)", code)
        // Notify before pauseForPolicy(): canceling this MonitorWorker can resume with
        // CancellationException and skip any code after miningController.pauseForPolicy().
        com.iml1s.xmrigminer.util.NotificationHelper.showWarning(context, reason)
        // Policy pause must not latch UserStopped (#124 / #126).
        miningController.pauseForPolicy(resetStats = false, reason = code ?: "monitor")
    }

    /**
     * Fallback when launch snapshot lacks power fields (legacy). Prefer [MiningConfig] values.
     */
    private fun androidRuntimePowerDefaults() = PowerPolicy.Defaults(
        requireExternalPower = false,
        pauseOnUnplug = false,
        chargeToPercentBeforeMine = null,
        minBatteryPercent = 20,
        resumeBatteryPercent = 30,
        pauseOnNetDischargeWhilePlugged = false
    )

    private data class TempReading(val tempC: Float?, val suspectZero: Boolean)
}
