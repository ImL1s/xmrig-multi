package com.iml1s.xmrigminer.service.quick

import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import com.iml1s.xmrigminer.service.MiningSessionLatch

/**
 * Quick Settings tile (#79). Snapshot + enqueue only — no RandomX in callback.
 */
class MiningQuickTileService : TileService() {
    override fun onStartListening() {
        super.onStartListening()
        refreshTile()
    }

    override fun onClick() {
        val snap = QuickCommandHandler.snapshot(
            mining = false,
            profileId = null,
            waitingReason = null
        )
        if (MiningSessionLatch.isUserStopped() || snap.userStopLatched) {
            // Unlock Stop path: open app to re-arm explicitly.
            QuickCommandHandler.handle(
                context = applicationContext,
                type = "open_clock",
                source = "tile"
            )
        } else if (qsTile?.state == Tile.STATE_ACTIVE) {
            QuickCommandHandler.handle(
                context = applicationContext,
                type = "stop_mining",
                source = "tile"
            )
        } else {
            QuickCommandHandler.handle(
                context = applicationContext,
                type = "start_profile",
                source = "tile",
                osStartAllowed = !isLocked
            )
        }
        refreshTile()
    }

    private fun refreshTile() {
        val tile = qsTile ?: return
        val stopped = MiningSessionLatch.isUserStopped()
        val paused = (QuickCommandHandler.pauseUntilMs > System.currentTimeMillis())
        tile.label = when {
            stopped -> "XMRig Stopped"
            paused -> "XMRig Paused"
            else -> "XMRig Multi"
        }
        tile.subtitle = QuickCommandHandler.lastAck.reason.take(40)
        tile.state = when {
            stopped || paused -> Tile.STATE_INACTIVE
            else -> Tile.STATE_ACTIVE
        }
        tile.updateTile()
    }
}
