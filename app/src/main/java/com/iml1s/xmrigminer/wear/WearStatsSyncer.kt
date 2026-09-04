package com.iml1s.xmrigminer.wear

import android.content.Context
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.tasks.Tasks
import com.iml1s.xmrigminer.data.model.MiningConfig
import com.iml1s.xmrigminer.data.model.MiningStats
import com.iml1s.xmrigminer.data.repository.ConfigRepository
import com.iml1s.xmrigminer.data.repository.StatsRepository
import com.iml1s.xmrigminer.service.MiningController
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WearStatsSyncer @Inject constructor(
    @ApplicationContext private val context: Context,
    private val statsRepository: StatsRepository,
    private val miningController: MiningController,
    private val configRepository: ConfigRepository
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun start() {
        scope.launch {
            combine(
                statsRepository.stats,
                miningController.isRunning(),
                configRepository.getConfig()
            ) { stats, running, config ->
                Triple(stats, running, config)
            }.collect { (stats, running, config) ->
                pushStats(stats, running, config)
            }
        }
    }

    fun publishNow() {
        scope.launch {
            statsRepository.tickUptime()
            val stats = statsRepository.stats.first()
            val running = miningController.isRunning().first()
            val config = configRepository.getConfig().first()
            pushStats(stats, running, config)
        }
    }

    private suspend fun pushStats(stats: MiningStats, running: Boolean, config: MiningConfig) {
        try {
            val request = PutDataMapRequest.create(WearPaths.STATS)
            request.dataMap.apply {
                putBoolean("isRunning", running)
                putDouble("hashrate", stats.hashrate)
                putLong("sharesAccepted", stats.acceptedShares.toLong())
                putLong("sharesRejected", stats.rejectedShares.toLong())
                putLong("difficulty", stats.difficulty)
                putLong("uptime", stats.uptime)
                putString("coinType", config.coinType)
                putString("poolName", config.poolUrl)
                putLong("syncAt", System.currentTimeMillis())
            }
            request.setUrgent()
            // Phone and Wear share applicationId com.iml1s.xmrigminer (debug: .debug).
            Tasks.await(Wearable.getDataClient(context).putDataItem(request.asPutDataRequest()))
        } catch (e: Exception) {
            Timber.d(e, "Wear stats sync skipped (no Wear runtime?)")
        }
    }
}
