package com.iml1s.xmrigminer.service

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.iml1s.xmrigminer.data.model.MiningConfig
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
            pauseMining("Temperature too high (${temp}°C)")
            return
        }
        if (level < MIN_BATTERY_LEVEL && !isCharging) {
            pauseMining("Battery too low ($level%)")
            return
        }
        // Launch-time solo snapshot (#15 / Codex P2): do not re-read DataStore mid-run.
        // Solo LAN: require any transport (OK without NET_CAPABILITY_INTERNET).
        // Solo loopback: on-device monerod needs no Wi-Fi/cellular.
        // Pool: require validated Internet.
        val networkOk = when {
            !soloDaemonAtLaunch -> networkMonitor.isConnected()
            isLoopbackDaemonEndpoint(launchConfig?.poolUrl) -> true
            else -> networkMonitor.hasNetworkTransport()
        }
        if (!networkOk) {
            pauseMining(
                if (soloDaemonAtLaunch) "No network transport" else "No network connection"
            )
        }
    }

    private fun isLoopbackDaemonEndpoint(poolUrl: String?): Boolean {
        if (poolUrl.isNullOrBlank()) return false
        val host = daemonHostFromPoolUrl(poolUrl)
        return host == "127.0.0.1" || host == "localhost" || host == "::1"
    }

    /** Host from `host:port`, `[ipv6]:port`, or bare loopback forms. */
    private fun daemonHostFromPoolUrl(poolUrl: String): String {
        val endpoint = poolUrl.trim().substringBefore('/').lowercase()
        if (endpoint.startsWith("[")) {
            return endpoint.substringAfter("[").substringBefore("]")
        }
        val colonCount = endpoint.count { it == ':' }
        if (colonCount > 1) {
            val lastColon = endpoint.lastIndexOf(':')
            val after = endpoint.substring(lastColon + 1)
            val before = endpoint.substring(0, lastColon)
            return if (after.all { it.isDigit() } && before.contains("::")) before else endpoint
        }
        return endpoint.substringBefore(':')
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

    private suspend fun pauseMining(reason: String) {
        Timber.w("Pausing mining: $reason")
        // Notify before stop(): canceling this MonitorWorker can resume with
        // CancellationException and skip any code after miningController.stop().
        com.iml1s.xmrigminer.util.NotificationHelper.showWarning(context, reason)
        miningController.stop(resetStats = false)
    }
}
