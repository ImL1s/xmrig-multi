package com.iml1s.xmrigminer.service

import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.iml1s.xmrigminer.data.model.CoinType
import com.iml1s.xmrigminer.data.model.MiningConfig
import com.iml1s.xmrigminer.data.daemon.DaemonEndpoint
import com.iml1s.xmrigminer.data.repository.ConfigRepository
import com.iml1s.xmrigminer.data.repository.StatsRepository
import com.iml1s.xmrigminer.native.XmrigNativeCapabilities
import com.iml1s.xmrigminer.native.XmrigProcessController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

sealed interface MiningStartResult {
    data object Started : MiningStartResult
    data class InvalidConfig(val message: String) : MiningStartResult
}

@Singleton
class MiningController @Inject constructor(
    private val workManager: WorkManager,
    private val configRepository: ConfigRepository,
    private val statsRepository: StatsRepository
) {
    fun isRunning(): Flow<Boolean> {
        return workManager.getWorkInfosForUniqueWorkFlow(MiningWorker.WORK_NAME)
            .map { infos -> infos.any { it.state == WorkInfo.State.RUNNING } }
    }

    suspend fun start(): MiningStartResult {
        val config = configRepository.getConfig().first()
        if (config.useTls && !XmrigNativeCapabilities.TLS_ENABLED) {
            return MiningStartResult.InvalidConfig(XmrigNativeCapabilities.TLS_UNSUPPORTED_MESSAGE)
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

        // #44: refuse to start solo when daemon URL cannot be parsed (e.g. http:// mis-host).
        // TCP reachability alone is never treated as mining-ready; RPC preflight is required
        // at the UI/service layer before claiming the node can mine.
        var launchConfig = config
        if (config.soloDaemon) {
            val parsed = DaemonEndpoint.parse(config.poolUrl)
            if (!parsed.ok || parsed.engineUrl.isNullOrBlank()) {
                return MiningStartResult.InvalidConfig(
                    parsed.error ?: "配置無效：節點 RPC 地址無法解析"
                )
            }
            if (parsed.engineUrl != config.poolUrl) {
                launchConfig = config.copy(poolUrl = parsed.engineUrl)
            }
            // Encode the TCP≠ready rule in the start gate message surface.
            val gate = DaemonEndpoint.preflightAfterTcp(
                raw = launchConfig.poolUrl,
                tcpOk = true,
                rpcProbed = false
            )
            if (gate.tcpOnly) {
                Timber.i(
                    "Solo start: URL ok (%s); RPC get_info still required for mining-ready (#44)",
                    launchConfig.poolUrl
                )
            }
        }

        stop(resetStats = false)

        val soloDaemon = launchConfig.soloDaemon
        val networkType = if (soloDaemon) {
            // LAN monerod may have no validated Internet capability (#15).
            NetworkType.NOT_REQUIRED
        } else {
            NetworkType.CONNECTED
        }
        val miningConstraints = Constraints.Builder()
            .setRequiredNetworkType(networkType)
            .build()

        val launchSnapshot = Data.Builder()
            .putBoolean(MonitorWorker.KEY_SOLO_DAEMON, soloDaemon)
            .putString(MiningWorker.KEY_CONFIG_SNAPSHOT, Json.encodeToString(MiningConfig.serializer(), launchConfig))
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
        Timber.i("Mining and monitoring work enqueued (soloDaemon=%s)", soloDaemon)
        return MiningStartResult.Started
    }

    suspend fun stop(resetStats: Boolean = true) = withContext(Dispatchers.IO) {
        workManager.cancelUniqueWork(MiningWorker.WORK_NAME)
        workManager.cancelUniqueWork(MonitorWorker.WORK_NAME)
        // WorkManager can mark the unique work CANCELLED (UI shows stopped) before the
        // CoroutineWorker finally block runs; XMRig may ignore soft destroy. Sweep same-UID
        // miner children so Stop always ends mining on device.
        val killed = XmrigProcessController.killLeftoverMiners()
        if (killed > 0) {
            Timber.i("Killed %d leftover XMRig process(es)", killed)
        }
        if (resetStats) {
            statsRepository.reset()
        }
        Timber.i("Mining and monitoring cancelled")
    }
}
