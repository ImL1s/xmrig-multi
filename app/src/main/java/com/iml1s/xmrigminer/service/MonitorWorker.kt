package com.iml1s.xmrigminer.service

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.iml1s.xmrigminer.data.repository.StatsRepository
import com.iml1s.xmrigminer.util.CpuMonitor
import com.iml1s.xmrigminer.util.NetworkMonitor
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.delay
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
        const val CHECK_INTERVAL = 5000L
        const val MAX_TEMPERATURE = 45f
        const val MIN_BATTERY_LEVEL = 20
    }

    private val cpuMonitor = CpuMonitor()

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

    private fun checkCriticalConditions() {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, 100) ?: 100
        val temp = getBatteryTemperature()
        val isCharging = isDeviceCharging()
        val isConnected = networkMonitor.isConnected()

        if (temp > MAX_TEMPERATURE) {
            pauseMining("Temperature too high (${temp}°C)")
            return
        }
        if (level < MIN_BATTERY_LEVEL && !isCharging) {
            pauseMining("Battery too low ($level%)")
            return
        }
        if (!isConnected) {
            pauseMining("No network connection")
        }
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

    private fun pauseMining(reason: String) {
        Timber.w("Pausing mining: $reason")
        miningController.stop(resetStats = false)
        com.iml1s.xmrigminer.util.NotificationHelper.showWarning(context, reason)
    }
}
