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
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
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
    private val pushLock = Any()
    private val deliverLock = Any()
    private var lastPushAtMs = 0L
    private var lastPublishedRunning: Boolean? = null
    private var nextDeliverSeq = 0L
    private var lastDeliveredSeq = 0L
    private var pending: Snapshot? = null
    private var flushJob: Job? = null

    /** Opaque session id so watches can detect phone restart (#62). */
    val sessionId: String = "phone-${System.currentTimeMillis()}"

    @Volatile
    var userStopLatched: Boolean = false
        private set

    fun markUserStopFromCompanion() {
        userStopLatched = true
    }

    fun clearUserStopLatchOnExplicitPhoneStart() {
        userStopLatched = false
    }

    fun start() {
        scope.launch {
            combine(
                statsRepository.stats,
                miningController.isRunning(),
                configRepository.getConfig()
            ) { stats, running, config ->
                Snapshot(stats, running, config)
            }.collect { snapshot ->
                pushStats(snapshot, force = false)
            }
        }
    }

    fun publishNow() {
        scope.launch {
            statsRepository.tickUptime()
            val stats = statsRepository.stats.first()
            val running = miningController.isRunning().first()
            val config = configRepository.getConfig().first()
            pushStats(Snapshot(stats, running, config), force = true)
        }
    }

    private fun pushStats(snapshot: Snapshot, force: Boolean) {
        val now = System.currentTimeMillis()
        var toSend: Snapshot? = null
        var urgent = false
        var seq = 0L
        synchronized(pushLock) {
            pending = snapshot
            val runningChanged = lastPublishedRunning != snapshot.running
            if (WearStatsPushPolicy.shouldPush(now, lastPushAtMs, runningChanged, force)) {
                toSend = pending
                pending = null
                flushJob?.cancel()
                flushJob = null
                urgent = WearStatsPushPolicy.urgent(runningChanged, force)
                lastPushAtMs = now
                lastPublishedRunning = snapshot.running
                nextDeliverSeq += 1
                seq = nextDeliverSeq
            } else if (flushJob?.isActive != true) {
                val waitMs = WearStatsPushPolicy.remainingMs(now, lastPushAtMs)
                flushJob = scope.launch { flushPendingAfter(waitMs) }
            }
        }
        toSend?.let { deliver(it, urgent, seq) }
    }

    private suspend fun flushPendingAfter(waitMs: Long) {
        delay(waitMs)
        var toSend: Snapshot? = null
        var urgent = false
        var seq = 0L
        synchronized(pushLock) {
            flushJob = null
            val snapshot = pending ?: return
            val now = System.currentTimeMillis()
            val runningChanged = lastPublishedRunning != snapshot.running
            if (!WearStatsPushPolicy.shouldPush(now, lastPushAtMs, runningChanged, force = false)) {
                val retryMs = WearStatsPushPolicy.remainingMs(now, lastPushAtMs)
                flushJob = scope.launch { flushPendingAfter(retryMs) }
                return
            }
            toSend = snapshot
            pending = null
            urgent = WearStatsPushPolicy.urgent(runningChanged, force = false)
            lastPushAtMs = now
            lastPublishedRunning = snapshot.running
            nextDeliverSeq += 1
            seq = nextDeliverSeq
        }
        toSend?.let { deliver(it, urgent, seq) }
    }

    private fun deliver(snapshot: Snapshot, urgent: Boolean, seq: Long) {
        synchronized(deliverLock) {
            if (seq <= lastDeliveredSeq) {
                return
            }
            lastDeliveredSeq = seq
            try {
                val request = PutDataMapRequest.create(WearPaths.STATS)
                val syncAt = System.currentTimeMillis()
                request.dataMap.apply {
                    putBoolean("isRunning", snapshot.running)
                    putDouble("hashrate", snapshot.stats.hashrate)
                    putLong("sharesAccepted", snapshot.stats.acceptedShares.toLong())
                    putLong("sharesRejected", snapshot.stats.rejectedShares.toLong())
                    putLong("difficulty", snapshot.stats.difficulty)
                    putLong("uptime", snapshot.stats.uptime)
                    putString("coinType", snapshot.config.coinType)
                    putString("poolName", snapshot.config.poolUrl)
                    // Never put wallet / password on the Data Layer (#62).
                    putLong("syncAt", syncAt)
                    putString("sessionId", sessionId)
                    putString("sourceDeviceId", "android-phone")
                    putString("syncQuality", "live")
                }
                if (urgent) {
                    request.setUrgent()
                }
                // Phone and Wear share applicationId com.iml1s.xmrigminer (debug: .debug).
                Tasks.await(Wearable.getDataClient(context).putDataItem(request.asPutDataRequest()))
            } catch (e: Exception) {
                Timber.d(e, "Wear stats sync skipped (no Wear runtime?)")
            }
        }
    }

    private data class Snapshot(
        val stats: MiningStats,
        val running: Boolean,
        val config: MiningConfig
    )
}
