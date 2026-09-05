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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import timber.log.Timber
import java.net.InetSocketAddress
import java.net.Socket

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
        private const val DEFAULT_DAEMON_PORT = 18081
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
            pauseMining("Temperature too high (${temp}°C)")
            return
        }
        if (level < MIN_BATTERY_LEVEL && !isCharging) {
            pauseMining("Battery too low ($level%)")
            return
        }
        // Launch-time solo snapshot (#15 / Codex P2): do not re-read DataStore mid-run.
        // Solo loopback: on-device monerod needs no Wi-Fi/cellular.
        // Solo LAN: probe daemon TCP reachability (cellular≠LAN).
        // Pool: require validated Internet.
        val networkOk = when {
            !soloDaemonAtLaunch -> networkMonitor.isConnected()
            isLoopbackDaemonEndpoint(launchConfig?.poolUrl) -> true
            else -> canReachDaemon(launchConfig?.poolUrl)
        }
        if (!networkOk) {
            pauseMining(
                if (soloDaemonAtLaunch) "Daemon unreachable" else "No network connection"
            )
        }
    }

    private fun isLoopbackDaemonEndpoint(poolUrl: String?): Boolean {
        if (poolUrl.isNullOrBlank()) return false
        val host = daemonHostFromPoolUrl(poolUrl)
        return host == "127.0.0.1" || host == "localhost" || host == "::1"
    }

    private suspend fun canReachDaemon(poolUrl: String?): Boolean {
        if (poolUrl.isNullOrBlank()) return false
        val host = daemonHostFromPoolUrl(poolUrl)
        val port = daemonPortFromPoolUrl(poolUrl)
        if (host.isBlank() || port !in 1..65535) return false
        return withContext(Dispatchers.IO) {
            try {
                Socket().use { socket ->
                    socket.connect(InetSocketAddress(host, port), DAEMON_PROBE_TIMEOUT_MS)
                    true
                }
            } catch (e: Exception) {
                Timber.d(e, "Solo daemon probe failed for %s:%d", host, port)
                false
            }
        }
    }

    /** Host from `host:port`, `[ipv6]:port`, or bare loopback forms. */
    private fun daemonHostFromPoolUrl(poolUrl: String): String {
        val endpoint = poolUrl.trim().substringBefore('/').lowercase()
        if (endpoint.startsWith("[")) {
            return endpoint.substringAfter("[").substringBefore("]")
        }
        val colonCount = endpoint.count { it == ':' }
        // Bare IPv6 has multiple colons and is portless; use [ipv6]:port instead.
        if (colonCount > 1) return endpoint
        return endpoint.substringBefore(':')
    }

    private fun daemonPortFromPoolUrl(poolUrl: String): Int {
        val endpoint = poolUrl.trim().substringBefore('/')
        if (endpoint.startsWith("[")) {
            val after = endpoint.substringAfter(']', missingDelimiterValue = "")
            return after.removePrefix(":").toIntOrNull() ?: DEFAULT_DAEMON_PORT
        }
        val colonCount = endpoint.count { it == ':' }
        // Bare IPv6 literals are portless; use [ipv6]:port for non-default ports.
        if (colonCount != 1) return DEFAULT_DAEMON_PORT
        return endpoint.substringAfter(':').toIntOrNull() ?: DEFAULT_DAEMON_PORT
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
