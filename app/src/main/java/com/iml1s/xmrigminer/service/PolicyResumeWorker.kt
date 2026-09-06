package com.iml1s.xmrigminer.service

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.iml1s.xmrigminer.data.repository.ConfigRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import timber.log.Timber

/**
 * Survives policy pause after MonitorWorker is cancelled (#126).
 * Re-checks power (+ Stop latch) and restarts via MiningController when clear.
 */
@HiltWorker
class PolicyResumeWorker @AssistedInject constructor(
    @Assisted private val context: Context,
    @Assisted params: WorkerParameters,
    private val miningController: MiningController,
    private val configRepository: ConfigRepository
) : CoroutineWorker(context, params) {

    companion object {
        const val WORK_NAME = "policy_resume_work"
        const val KEY_REASON = "reason"
        const val KEY_STOP_REVISION = "stop_revision_at_pause"
        private const val POLL_MS = 15_000L
        private const val MAX_POLLS = 240 // ~1 hour
    }

    override suspend fun doWork(): Result {
        val stopAtPause = inputData.getLong(KEY_STOP_REVISION, 0L).toInt()
        val reason = inputData.getString(KEY_REASON) ?: "policy"
        Timber.i("PolicyResumeWorker watching for recovery after: %s", reason)

        repeat(MAX_POLLS) { tick ->
            if (MiningSessionLatch.isUserStopped() ||
                MiningSessionLatch.userStopRevision > stopAtPause
            ) {
                Timber.i("PolicyResumeWorker abort — UserStopped")
                MiningSessionLatch.clearPolicyPauseIfCurrent()
                return Result.success()
            }

            val config = configRepository.getConfig().first()
            val obs = readPowerObservation()
            val verdict = PowerPolicy.evaluate(
                observation = obs,
                intent = PowerPolicy.armSession(
                    PowerPolicy.Intent(
                        userStopRevision = MiningSessionLatch.userStopRevision,
                        sessionArmedRevision = MiningSessionLatch.sessionArmedRevisionValue,
                        automationArmed = MiningSessionLatch.isAutomationArmed()
                    ),
                    automationArmed = MiningSessionLatch.isAutomationArmed()
                ),
                config = miningController.powerDefaultsFrom(config),
                nowMs = System.currentTimeMillis()
            )

            if (verdict.kind == PowerPolicy.Kind.ALLOWED &&
                MiningSessionLatch.isAutomationArmed() &&
                !MiningSessionLatch.isUserStopped()
            ) {
                when (val start = miningController.resumeAfterPolicy(powerObservation = obs)) {
                    is MiningStartResult.Started -> {
                        MiningSessionLatch.clearPolicyPauseIfCurrent()
                        Timber.i("PolicyResumeWorker restarted mining after %s (tick=%d)", reason, tick)
                        return Result.success()
                    }
                    is MiningStartResult.InvalidConfig -> {
                        Timber.w("PolicyResumeWorker start blocked: %s", start.message)
                    }
                }
            } else {
                Timber.d(
                    "PolicyResumeWorker waiting kind=%s reasons=%s",
                    verdict.kind,
                    verdict.reasons
                )
            }
            delay(POLL_MS)
        }
        Timber.w("PolicyResumeWorker timed out waiting for recovery")
        return Result.success()
    }

    private fun readPowerObservation(): PowerPolicy.Observation {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            ?: return PowerPolicy.Observation(
                quality = PowerPolicy.Quality.FAILED,
                note = "Battery intent unavailable",
                timestampMs = System.currentTimeMillis()
            )
        val status = when (intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)) {
            BatteryManager.BATTERY_STATUS_CHARGING -> PowerPolicy.ChargingStatus.CHARGING
            BatteryManager.BATTERY_STATUS_FULL -> PowerPolicy.ChargingStatus.FULL
            BatteryManager.BATTERY_STATUS_NOT_CHARGING -> PowerPolicy.ChargingStatus.NOT_CHARGING
            BatteryManager.BATTERY_STATUS_DISCHARGING -> PowerPolicy.ChargingStatus.DISCHARGING
            else -> PowerPolicy.ChargingStatus.UNKNOWN
        }
        val pluggedFlag = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)
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
        val flowMa = when {
            currentUa == null || currentUa == Int.MIN_VALUE -> null
            else -> currentUa / 1000
        }
        return PowerPolicy.Observation(
            platformHasBattery = true,
            batteryApiAvailable = true,
            externalPowerPresent = pluggedFlag != 0,
            powerSource = source,
            chargingStatus = status,
            socPercent = soc,
            netBatteryFlowMa = flowMa,
            quality = PowerPolicy.Quality.OK,
            timestampMs = System.currentTimeMillis()
        )
    }
}
