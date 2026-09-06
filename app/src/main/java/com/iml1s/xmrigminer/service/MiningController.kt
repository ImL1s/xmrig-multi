package com.iml1s.xmrigminer.service

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.iml1s.xmrigminer.data.daemon.DaemonEndpointParser
import com.iml1s.xmrigminer.data.daemon.DaemonRpcProbe
import com.iml1s.xmrigminer.data.hardware.MemoryLaunchGate
import com.iml1s.xmrigminer.data.model.CoinType
import com.iml1s.xmrigminer.data.model.MiningConfig
import com.iml1s.xmrigminer.data.repository.ConfigRepository
import com.iml1s.xmrigminer.data.repository.StatsRepository
import com.iml1s.xmrigminer.native.XmrigNativeCapabilities
import com.iml1s.xmrigminer.native.XmrigProcessController
import com.iml1s.xmrigminer.wear.WearStatsSyncer
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import timber.log.Timber
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import javax.inject.Inject
import javax.inject.Provider
import javax.inject.Singleton

sealed interface MiningStartResult {
    data object Started : MiningStartResult
    data class InvalidConfig(val message: String) : MiningStartResult
}

@Singleton
class MiningController @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val workManager: WorkManager,
    private val configRepository: ConfigRepository,
    private val statsRepository: StatsRepository,
    private val wearStatsSyncer: Provider<WearStatsSyncer>,
    private val energySessionMeter: EnergySessionMeter
) {
    private val sessionGeneration = AtomicLong(0L)
    private val runtimeThreadOverride = AtomicReference<Int?>(null)
    private val lastAppliedThreads = AtomicInteger(0)
    private val oomRetryBudget = MemoryLaunchGate.RetryBudget(maxRetries = 1)

    fun currentSessionGeneration(): Long = sessionGeneration.get()

    fun lastAppliedThreads(): Int = lastAppliedThreads.get()

    fun isRunning(): Flow<Boolean> {
        return workManager.getWorkInfosForUniqueWorkFlow(MiningWorker.WORK_NAME)
            .map { infos -> infos.any { it.state == WorkInfo.State.RUNNING } }
    }

    /**
     * Explicit Start. Validates first; only then arms session and replaces engine.
     * Invalid config does **not** clear a prior UserStopped latch (#124).
     */
    suspend fun start(powerObservation: PowerPolicy.Observation? = null): MiningStartResult {
        var config = configRepository.getConfig().first()
        validateStartConfig(config)?.let { return it }

        // Pre-start power gate — waiting must not allocate RandomX (#126).
        val obs = powerObservation ?: readPowerObservation()
        evaluatePowerGate(config, obs)?.let { return it }

        // Pre-start memory gate — hard limit / OOM retry must not allocate (#129).
        evaluateMemoryGate(config)?.let { return it }

        // Pre-start energy budget — spent/unknown ledger must pause before allocate (#130).
        evaluateEnergyBudgetGate(config)?.let { return it }

        if (config.soloDaemon) {
            val parsed = DaemonEndpointParser.parse(config.poolUrl, allowHttps = false)
            if (!parsed.ok || parsed.endpoint == null) {
                return MiningStartResult.InvalidConfig(parsed.message)
            }
            config = config.copy(poolUrl = parsed.endpoint.engineUrl)
            val probe = DaemonRpcProbe.probe(config.poolUrl)
            if (!probe.readyToMine) {
                val detail = buildString {
                    append(probe.message)
                    append(" [stage=").append(probe.stage).append(']')
                    probe.remediation?.let { append(" — ").append(it) }
                }
                return MiningStartResult.InvalidConfig(detail)
            }
            Timber.i(
                "Solo daemon ready (stage=%s height=%s url=%s)",
                probe.stage,
                probe.height,
                probe.engineUrl
            )
        }

        wearStatsSyncer.get().clearUserStopLatchOnExplicitPhoneStart()
        if (!MiningSessionSequencer.onValidatedStartReady()) {
            return MiningStartResult.InvalidConfig("Session arm failed — Stop still latched")
        }

        runtimeThreadOverride.set(null)
        workManager.cancelUniqueWork(PolicyResumeWorker.WORK_NAME)
        return enqueueMining(config, resetStats = false, cancelPolicyResume = false)
    }

    /**
     * Soft-throttle path (#125): request temporary thread override without claiming applied.
     * Returns requested threads when enqueue succeeds (PENDING); caller must verify via
     * [verifyRuntimeThreadOverride] before advertising APPLIED.
     */
    suspend fun requestRuntimeThreadOverride(threads: Int, reason: String): Int? =
        withContext(Dispatchers.IO) {
            if (MiningSessionLatch.isUserStopped()) {
                Timber.w("Skip thread override — UserStopped")
                return@withContext null
            }
            if (threads <= 0) return@withContext null
            if (sessionGeneration.get() == 0L) return@withContext null
            val base = configRepository.getConfig().first()
            val overridden = base.copy(threads = threads, threadsAuto = false)
            runtimeThreadOverride.set(threads)
            if (!relaunchMiningWorkerOnly(overridden)) {
                runtimeThreadOverride.set(null)
                return@withContext null
            }
            Timber.i("Runtime thread override enqueued threads=%d (%s) — pending verify", threads, reason)
            threads
        }

    /**
     * True when MiningWorker is RUNNING/ENQUEUED after a pending override/clear request.
     * Clear path: [runtimeThreadOverride] is null and [expectedThreads] equals permanent DataStore
     * threads (so restore verify does not stick forever). Does not prove OS-level CPU load.
     */
    suspend fun verifyRuntimeThreadOverride(expectedThreads: Int): Boolean = withContext(Dispatchers.IO) {
        val permanent = configRepository.getConfig().first().threads
        if (!matchesThreadOverrideReadback(runtimeThreadOverride.get(), expectedThreads, permanent)) {
            return@withContext false
        }
        val infos = workManager.getWorkInfosForUniqueWork(MiningWorker.WORK_NAME).get()
        val active = infos.any {
            it.state == WorkInfo.State.RUNNING || it.state == WorkInfo.State.ENQUEUED
        }
        if (active) {
            lastAppliedThreads.set(expectedThreads)
        }
        active
    }

    suspend fun requestClearRuntimeThreadOverride(reason: String): Int? = withContext(Dispatchers.IO) {
        val base = configRepository.getConfig().first()
        val previousOverride = runtimeThreadOverride.get()
        // Null override = use permanent DataStore profile; verify accepts null + permanent match.
        runtimeThreadOverride.set(null)
        if (!relaunchMiningWorkerOnly(base)) {
            runtimeThreadOverride.set(previousOverride)
            return@withContext null
        }
        Timber.i("Permanent threads restore enqueued threads=%d (%s) — pending verify", base.threads, reason)
        base.threads
    }

    companion object {
        /**
         * Soft throttle: override must equal expected.
         * Thermal resume clear: override is null and expected equals permanent DataStore threads.
         */
        internal fun matchesThreadOverrideReadback(
            runtimeOverride: Int?,
            expectedThreads: Int,
            permanentThreads: Int
        ): Boolean = when {
            runtimeOverride == expectedThreads -> true
            runtimeOverride == null && expectedThreads == permanentThreads -> true
            else -> false
        }
    }

    /**
     * Policy automation resume (#126): enqueue mining without cancelling [PolicyResumeWorker]
     * and without Wear "explicit Start" side effects.
     */
    suspend fun resumeAfterPolicy(powerObservation: PowerPolicy.Observation? = null): MiningStartResult {
        if (MiningSessionLatch.isUserStopped()) {
            return MiningStartResult.InvalidConfig("Stop latched — resume cancelled")
        }
        var config = configRepository.getConfig().first()
        validateStartConfig(config)?.let { return it }
        val obs = powerObservation ?: readPowerObservation()
        evaluatePowerGate(config, obs)?.let { return it }
        evaluateMemoryGate(config)?.let { return it }
        evaluateEnergyBudgetGate(config)?.let { return it }

        if (config.soloDaemon) {
            val parsed = DaemonEndpointParser.parse(config.poolUrl, allowHttps = false)
            if (!parsed.ok || parsed.endpoint == null) {
                return MiningStartResult.InvalidConfig(parsed.message)
            }
            config = config.copy(poolUrl = parsed.endpoint.engineUrl)
        }

        // Re-arm session for policy resume without treating as brand-new user Start.
        if (!MiningSessionSequencer.onValidatedStartReady()) {
            return MiningStartResult.InvalidConfig("Session arm failed — Stop still latched")
        }
        runtimeThreadOverride.set(null)
        return enqueueMining(config, resetStats = false, cancelPolicyResume = false)
    }

    /** @deprecated Use [requestRuntimeThreadOverride] + [verifyRuntimeThreadOverride]. */
    suspend fun applyRuntimeThreadOverride(threads: Int, reason: String): Int? =
        requestRuntimeThreadOverride(threads, reason)

    suspend fun clearRuntimeThreadOverride(reason: String): Int? =
        requestClearRuntimeThreadOverride(reason)

    /** Replace MiningWorker only — keep MonitorWorker alive for continuous policy (#125). */
    private suspend fun relaunchMiningWorkerOnly(config: MiningConfig): Boolean {
        return try {
            workManager.cancelUniqueWork(MiningWorker.WORK_NAME)
            val killed = XmrigProcessController.killLeftoverMiners()
            if (killed > 0) {
                Timber.i("Killed %d leftover XMRig process(es) for throttle relaunch", killed)
            }
            val soloDaemon = config.soloDaemon
            val networkType = if (soloDaemon) NetworkType.NOT_REQUIRED else NetworkType.CONNECTED
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(networkType)
                .build()
            val launchSnapshot = Data.Builder()
                .putBoolean(MonitorWorker.KEY_SOLO_DAEMON, soloDaemon)
                .putString(MiningWorker.KEY_CONFIG_SNAPSHOT, Json.encodeToString(MiningConfig.serializer(), config))
                .putLong(MonitorWorker.KEY_SESSION_GENERATION, sessionGeneration.get())
                .build()
            val miningRequest = OneTimeWorkRequestBuilder<MiningWorker>()
                .setConstraints(constraints)
                .setInputData(launchSnapshot)
                .addTag("mining")
                .build()
            workManager.enqueueUniqueWork(
                MiningWorker.WORK_NAME,
                ExistingWorkPolicy.REPLACE,
                miningRequest
            )
            true
        } catch (e: Exception) {
            Timber.e(e, "Failed to relaunch mining worker for throttle")
            false
        }
    }

    /**
     * Explicit user Stop — latches UserStopped and cancels engine (#124).
     */
    suspend fun stop(resetStats: Boolean = true) = withContext(Dispatchers.IO) {
        MiningSessionSequencer.onUserStop()
        runtimeThreadOverride.set(null)
        workManager.cancelUniqueWork(PolicyResumeWorker.WORK_NAME)
        cancelEngine(resetStats)
        Timber.i("Mining and monitoring cancelled (user stop)")
    }

    /**
     * Thermal / power / budget pause — cancels engine without UserStopped (#124 / #126).
     * Schedules [PolicyResumeWorker] so pause is recoverable.
     */
    suspend fun pauseForPolicy(
        resetStats: Boolean = false,
        untilMs: Long = 0L,
        reason: String = "policy"
    ) = withContext(Dispatchers.IO) {
        MiningSessionSequencer.onPolicyPause(untilMs)
        cancelEngine(resetStats)
        schedulePolicyResume(reason)
        Timber.i("Mining paused for policy (untilMs=%s reason=%s)", untilMs, reason)
    }

    fun powerDefaultsFrom(config: MiningConfig): PowerPolicy.Defaults {
        return PowerPolicy.Defaults(
            requireExternalPower = config.requireExternalPower,
            pauseOnUnplug = config.pauseOnUnplug,
            chargeToPercentBeforeMine = config.chargeToPercentBeforeMine,
            minBatteryPercent = config.minBatteryPercent,
            resumeBatteryPercent = config.resumeBatteryPercent,
            pauseOnNetDischargeWhilePlugged = config.pauseOnNetDischargeWhilePlugged
        )
    }

    fun evaluatePowerGate(
        config: MiningConfig,
        observation: PowerPolicy.Observation,
        nowMs: Long = System.currentTimeMillis()
    ): MiningStartResult.InvalidConfig? {
        val verdict = PowerPolicy.evaluate(
            observation = observation,
            intent = PowerPolicy.armSession(PowerPolicy.Intent(), automationArmed = true),
            config = powerDefaultsFrom(config),
            nowMs = nowMs
        )
        return when (verdict.kind) {
            PowerPolicy.Kind.ALLOWED -> null
            else -> MiningStartResult.InvalidConfig(
                verdict.reasons.firstOrNull() ?: "Power policy blocked start"
            )
        }
    }

    /**
     * Memory hard/soft gate before enqueue (#129). Blocked → no RandomX allocation.
     */
    fun evaluateMemoryGate(
        config: MiningConfig,
        observation: MemoryLaunchGate.Observation? = null,
        allocationFailed: Boolean = false
    ): MiningStartResult.InvalidConfig? {
        if (config.getCoin() == CoinType.DERO) return null
        val mem = observation ?: readMemoryObservation()
        val verdict = MemoryLaunchGate.evaluate(
            config = config,
            observation = mem,
            allocationFailed = allocationFailed,
            retryBudget = if (allocationFailed) oomRetryBudget else null,
            sessionGeneration = sessionGeneration.get()
        )
        if (verdict.allowed) return null
        return MiningStartResult.InvalidConfig(
            verdict.reasons.firstOrNull()
                ?: "Memory gate blocked start — free RAM or use light mode"
        )
    }

    /**
     * Energy budget gate before enqueue (#130). Cap hit / unknown ledger → no start.
     */
    fun evaluateEnergyBudgetGate(
        config: MiningConfig,
        nowMs: Long = System.currentTimeMillis()
    ): MiningStartResult.InvalidConfig? {
        if (config.dailySpendCapFiat == null &&
            config.dailyKwhCap == null &&
            config.monthlySpendCapFiat == null
        ) {
            return null
        }
        energySessionMeter.applyConfig(config)
        val verdict = energySessionMeter.evaluateBudget(
            config = config,
            sessionElapsedMs = null,
            nowMs = nowMs
        )
        val block = EnergyBudgetActuator.startBlockReason(verdict) ?: return null
        return MiningStartResult.InvalidConfig(block)
    }

    fun readMemoryObservation(): MemoryLaunchGate.Observation {
        return try {
            val am = appContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val info = ActivityManager.MemoryInfo()
            am.getMemoryInfo(info)
            MemoryLaunchGate.Observation(
                availableBytes = info.availMem,
                totalBytes = info.totalMem,
                processLimitBytes = null
            )
        } catch (e: Exception) {
            Timber.w(e, "Memory observation failed — gate uses unknown available")
            MemoryLaunchGate.Observation()
        }
    }

    private suspend fun enqueueMining(
        config: MiningConfig,
        resetStats: Boolean,
        bumpGeneration: Boolean = true,
        cancelPolicyResume: Boolean = true
    ): MiningStartResult {
        stopEngine(resetStats)
        if (cancelPolicyResume) {
            workManager.cancelUniqueWork(PolicyResumeWorker.WORK_NAME)
        }
        if (bumpGeneration) {
            sessionGeneration.incrementAndGet()
        }

        energySessionMeter.applyConfig(config)
        energySessionMeter.onSessionStart("session-${sessionGeneration.get()}")

        val soloDaemon = config.soloDaemon
        val networkType = if (soloDaemon) {
            NetworkType.NOT_REQUIRED
        } else {
            NetworkType.CONNECTED
        }
        val miningConstraints = Constraints.Builder()
            .setRequiredNetworkType(networkType)
            .build()

        val launchSnapshot = Data.Builder()
            .putBoolean(MonitorWorker.KEY_SOLO_DAEMON, soloDaemon)
            .putString(MiningWorker.KEY_CONFIG_SNAPSHOT, Json.encodeToString(MiningConfig.serializer(), config))
            .putLong(MonitorWorker.KEY_SESSION_GENERATION, sessionGeneration.get())
            .build()

        val miningRequest = OneTimeWorkRequestBuilder<MiningWorker>()
            .setConstraints(miningConstraints)
            .setInputData(launchSnapshot)
            .addTag("mining")
            .build()

        val monitorRequest = OneTimeWorkRequestBuilder<MonitorWorker>()
            .setConstraints(miningConstraints)
            .setInputData(launchSnapshot)
            .addTag("monitor")
            .build()

        workManager.enqueueUniqueWork(
            MiningWorker.WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            miningRequest
        )
        workManager.enqueueUniqueWork(
            MonitorWorker.WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            monitorRequest
        )
        lastAppliedThreads.set(if (config.threadsAuto) 0 else config.threads)
        Timber.i("Mining and monitoring work enqueued (soloDaemon=%s threads=%s)", soloDaemon, config.threads)
        return MiningStartResult.Started
    }

    private fun schedulePolicyResume(reason: String) {
        val data = Data.Builder()
            .putString(PolicyResumeWorker.KEY_REASON, reason)
            .putLong(PolicyResumeWorker.KEY_STOP_REVISION, MiningSessionLatch.userStopRevision.toLong())
            .build()
        val req = OneTimeWorkRequestBuilder<PolicyResumeWorker>()
            .setInputData(data)
            .addTag("policy_resume")
            .build()
        workManager.enqueueUniqueWork(
            PolicyResumeWorker.WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            req
        )
    }

    private suspend fun stopEngine(resetStats: Boolean) = withContext(Dispatchers.IO) {
        MiningSessionSequencer.onEngineReplaceCleanup()
        cancelEngine(resetStats)
    }

    private suspend fun cancelEngine(resetStats: Boolean) {
        val config = runCatching { configRepository.getConfig().first() }.getOrNull()
        if (config != null) {
            runCatching { energySessionMeter.onSessionStop(config) }
        }
        workManager.cancelUniqueWork(MiningWorker.WORK_NAME)
        workManager.cancelUniqueWork(MonitorWorker.WORK_NAME)
        val killed = XmrigProcessController.killLeftoverMiners()
        if (killed > 0) {
            Timber.i("Killed %d leftover XMRig process(es)", killed)
        }
        if (resetStats) {
            statsRepository.reset()
        }
    }

    private fun validateStartConfig(config: MiningConfig): MiningStartResult.InvalidConfig? {
        if (config.useTls && !XmrigNativeCapabilities.TLS_ENABLED) {
            return MiningStartResult.InvalidConfig(XmrigNativeCapabilities.TLS_UNSUPPORTED_MESSAGE)
        }
        XmrigNativeCapabilities.assertSoloDaemonAllowed(config)?.let {
            return MiningStartResult.InvalidConfig(it)
        }
        XmrigNativeCapabilities.assertStartAllowed(config.getCoin())?.let {
            return MiningStartResult.InvalidConfig(it)
        }
        XmrigNativeCapabilities.assertMoneroOceanPayout(
            config.poolUrl,
            config.getCoin(),
            config.walletAddress
        )?.let {
            return MiningStartResult.InvalidConfig(it)
        }
        if (!config.isValid() || config.walletAddress.isBlank()) {
            val message = when {
                config.walletAddress.isBlank() -> "配置無效：錢包地址未設置"
                config.poolUrl.isBlank() ->
                    if (config.soloDaemon) "配置無效：節點 RPC 地址未設置" else "配置無效：礦池地址未設置"
                config.soloDaemon && config.getCoin() != CoinType.MONERO ->
                    "Solo 僅支援 Monero"
                else -> "配置無效，請檢查設置"
            }
            return MiningStartResult.InvalidConfig(message)
        }
        return null
    }

    /** Battery / plug snapshot for Start and Dream pre-checks (#126/#127). */
    fun readPowerObservation(): PowerPolicy.Observation {
        val intent = appContext.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
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
        val batteryManager = appContext.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
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
