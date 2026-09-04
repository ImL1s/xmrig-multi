package com.iml1s.xmrigminer.service

import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.iml1s.xmrigminer.data.repository.ConfigRepository
import com.iml1s.xmrigminer.data.repository.StatsRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
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
        if (!config.isValid() || config.walletAddress.isBlank()) {
            val message = when {
                config.walletAddress.isBlank() -> "配置無效：錢包地址未設置"
                config.poolUrl.isBlank() -> "配置無效：礦池地址未設置"
                else -> "配置無效，請檢查設置"
            }
            return MiningStartResult.InvalidConfig(message)
        }

        stop(resetStats = false)

        val miningConstraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val miningRequest = OneTimeWorkRequestBuilder<MiningWorker>()
            .setConstraints(miningConstraints)
            .addTag("mining")
            .build()

        val monitorRequest = OneTimeWorkRequestBuilder<MonitorWorker>()
            .setConstraints(miningConstraints)
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
        Timber.i("Mining and monitoring work enqueued")
        return MiningStartResult.Started
    }

    fun stop(resetStats: Boolean = true) {
        workManager.cancelUniqueWork(MiningWorker.WORK_NAME)
        workManager.cancelUniqueWork(MonitorWorker.WORK_NAME)
        if (resetStats) {
            statsRepository.reset()
        }
        Timber.i("Mining and monitoring cancelled")
    }
}
