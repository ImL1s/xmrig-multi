package com.iml1s.xmrigminer.service.quick

import android.annotation.SuppressLint
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import androidx.annotation.RequiresApi
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.iml1s.xmrigminer.service.MiningSessionLatch
import com.iml1s.xmrigminer.service.MiningWorker

/**
 * Quick Settings tile (#79). Snapshot + enqueue only — no RandomX in callback.
 * TileService requires API 24+.
 */
@RequiresApi(Build.VERSION_CODES.N)
class MiningQuickTileService : TileService() {
    override fun onStartListening() {
        super.onStartListening()
        refreshTile()
    }

    override fun onClick() {
        val mining = isMiningActive()
        when {
            mining -> {
                QuickCommandHandler.handle(
                    context = applicationContext,
                    type = "stop_mining",
                    source = "tile"
                )
            }
            MiningSessionLatch.isUserStopped() -> {
                QuickCommandHandler.handle(
                    context = applicationContext,
                    type = "open_clock",
                    source = "tile"
                )
            }
            else -> {
                QuickCommandHandler.handle(
                    context = applicationContext,
                    type = "start_profile",
                    source = "tile",
                    osStartAllowed = !isLocked
                )
            }
        }
        refreshTile()
    }

    @SuppressLint("NewApi")
    private fun refreshTile() {
        val tile = qsTile ?: return
        val mining = isMiningActive()
        val stopped = MiningSessionLatch.isUserStopped()
        val paused = MiningSessionLatch.isPolicyPaused()
        tile.label = when {
            stopped -> "XMRig Stopped"
            paused -> "XMRig Paused"
            mining -> "XMRig Mining"
            else -> "XMRig Multi"
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = QuickCommandHandler.lastAck.reason.take(40)
        }
        tile.state = when {
            mining -> Tile.STATE_ACTIVE
            else -> Tile.STATE_INACTIVE
        }
        tile.updateTile()
    }

    private fun isMiningActive(): Boolean {
        return try {
            val infos = WorkManager.getInstance(applicationContext)
                .getWorkInfosForUniqueWork(MiningWorker.WORK_NAME)
                .get()
            infos.any {
                it.state == WorkInfo.State.RUNNING || it.state == WorkInfo.State.ENQUEUED
            }
        } catch (_: Exception) {
            false
        }
    }
}
