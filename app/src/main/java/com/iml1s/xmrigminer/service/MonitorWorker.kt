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
        const val CHECK_INTERVAL = 5000L
        const val MAX_TEMPERATURE = 45f
        const val MIN_BATTERY_LEVEL = 20
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

    override suspend fun doWork(): Result {
        Timber.i("MonitorWorker started")
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
            statsRepository.updateChargingState(isDeviceCharging())
        } catch (e: Exception) {
            Timber.w(e, "Failed to update battery stats")
        }
    }

    private fun updateThermalStats() {
        try {
            statsRepository.updateTemperature(getBatteryTemperature())
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
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, 100) ?: 100
        val temp = getBatteryTemperature()
        val isCharging = isDeviceCharging()
        if (temp > MAX_TEMPERATURE) {
            // #43: thermal is a policy pause — cancel retries, do not auto-restart.
            pauseMining("Temperature too high (${temp}°C)", code = "thermal")
            return
        }
        if (level < MIN_BATTERY_LEVEL && !isCharging) {
            pauseMining("Battery too low ($level%)", code = "battery")
            return
        }
        // Launch-time solo snapshot (#15 / Codex P2): do not re-read DataStore mid-run.
        // Solo: RPC readiness probe (not TCP-only) (#44). Pool: require validated Internet.
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
            // #43: transient network loss with autoReconnect → leave MiningWorker alive
            // so XMRig/native retries apply; only hard-stop when autoReconnect is off
            // or classification says pause/fatal. Solo LAN probe failure stays a pause
            // (daemon may be intentional offline) unless autoReconnect is on.
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

    private fun isDeviceCharging(): Boolean {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val status = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        return status == BatteryManager.BATTERY_STATUS_CHARGING ||
            status == BatteryManager.BATTERY_STATUS_FULL
    }

    private fun getBatteryTemperature(): Float {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val temp = intent?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0
        return temp / 10f
    }

    private suspend fun pauseMining(reason: String, code: String? = null) {
        Timber.w("Pausing mining: $reason (code=%s)", code)
        // Notify before stop(): canceling this MonitorWorker can resume with
        // CancellationException and skip any code after miningController.stop().
        com.iml1s.xmrigminer.util.NotificationHelper.showWarning(context, reason)
        miningController.stop(resetStats = false)
    }
}
