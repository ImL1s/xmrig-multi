package com.iml1s.xmrigminer.wear.tile

import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DeviceParametersBuilders
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER
import androidx.wear.protolayout.LayoutElementBuilders.VERTICAL_ALIGN_CENTER
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.protolayout.material.Text
import androidx.wear.protolayout.material.Typography
import androidx.wear.protolayout.material.layouts.PrimaryLayout
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import java.util.concurrent.TimeUnit

class MiningTileService : TileService() {

    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
        val stats = getMiningStats()
        val tile = TileBuilders.Tile.Builder()
            .setResourcesVersion(RESOURCES_VERSION)
            .setFreshnessIntervalMillis(5000)
            .setTileTimeline(
                TimelineBuilders.Timeline.Builder()
                    .addTimelineEntry(
                        TimelineBuilders.TimelineEntry.Builder()
                            .setLayout(
                                LayoutElementBuilders.Layout.Builder()
                                    .setRoot(createTileLayout(stats))
                                    .build()
                            )
                            .build()
                    )
                    .build()
            )
            .build()
        return Futures.immediateFuture(tile)
    }

    override fun onTileResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest
    ): ListenableFuture<ResourceBuilders.Resources> {
        return Futures.immediateFuture(
            ResourceBuilders.Resources.Builder().setVersion(RESOURCES_VERSION).build()
        )
    }

    private fun createTileLayout(stats: MiningStats): LayoutElementBuilders.LayoutElement {
        val deviceParams = DeviceParametersBuilders.DeviceParameters.Builder()
            .setScreenWidthDp(200)
            .setScreenHeightDp(200)
            .build()

        return PrimaryLayout.Builder(deviceParams)
            .setResponsiveContentInsetEnabled(true)
            .setContent(
                LayoutElementBuilders.Column.Builder()
                    .setWidth(expand())
                    .setHorizontalAlignment(HORIZONTAL_ALIGN_CENTER)
                    .addContent(
                        Text.Builder(this, if (stats.isRunning) "Mining" else "Stopped")
                            .setTypography(Typography.TYPOGRAPHY_CAPTION1)
                            .setColor(argb(if (stats.isRunning) 0xFF10B981.toInt() else 0xFF94A3B8.toInt()))
                            .build()
                    )
                    .addContent(LayoutElementBuilders.Spacer.Builder().setHeight(dp(8f)).build())
                    .addContent(
                        Text.Builder(this, "%.1f".format(stats.hashrate))
                            .setTypography(Typography.TYPOGRAPHY_DISPLAY1)
                            .setColor(argb(0xFF7C3AED.toInt()))
                            .build()
                    )
                    .addContent(
                        Text.Builder(this, "H/s")
                            .setTypography(Typography.TYPOGRAPHY_CAPTION2)
                            .setColor(argb(0xFF94A3B8.toInt()))
                            .build()
                    )
                    .addContent(LayoutElementBuilders.Spacer.Builder().setHeight(dp(12f)).build())
                    .addContent(
                        LayoutElementBuilders.Row.Builder()
                            .setWidth(expand())
                            .setVerticalAlignment(VERTICAL_ALIGN_CENTER)
                            .addContent(
                                Text.Builder(this, "A ${stats.accepted}")
                                    .setTypography(Typography.TYPOGRAPHY_CAPTION1)
                                    .setColor(argb(0xFF10B981.toInt()))
                                    .build()
                            )
                            .addContent(LayoutElementBuilders.Spacer.Builder().setWidth(dp(16f)).build())
                            .addContent(
                                Text.Builder(this, "R ${stats.rejected}")
                                    .setTypography(Typography.TYPOGRAPHY_CAPTION1)
                                    .setColor(argb(0xFFEF4444.toInt()))
                                    .build()
                            )
                            .build()
                    )
                    .build()
            )
            .build()
    }

    private fun getMiningStats(): MiningStats {
        return try {
            val dataItems = Tasks.await(Wearable.getDataClient(this).dataItems, 2, TimeUnit.SECONDS)
            val statsItem = dataItems.find { it.uri.path == PATH_MINING_STATS }
            if (statsItem != null) {
                val dataMap = DataMapItem.fromDataItem(statsItem).dataMap
                MiningStats(
                    isRunning = dataMap.getBoolean("isRunning", false),
                    hashrate = dataMap.getDouble("hashrate", 0.0),
                    accepted = dataMap.getLong("sharesAccepted", 0),
                    rejected = dataMap.getLong("sharesRejected", 0)
                )
            } else {
                MiningStats()
            }
        } catch (_: Exception) {
            MiningStats()
        }
    }

    data class MiningStats(
        val isRunning: Boolean = false,
        val hashrate: Double = 0.0,
        val accepted: Long = 0,
        val rejected: Long = 0
    )

    companion object {
        private const val RESOURCES_VERSION = "1"
        private const val PATH_MINING_STATS = "/mining/stats"
    }
}
