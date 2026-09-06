package com.iml1s.xmrigminer.service.quick

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.iml1s.xmrigminer.R
import com.iml1s.xmrigminer.presentation.MainActivity
import com.iml1s.xmrigminer.service.MiningSessionLatch

/**
 * Home-screen widget (#79). Read snapshot + PendingIntent commands only.
 */
class MiningQuickWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (id in appWidgetIds) {
            updateAppWidget(context, appWidgetManager, id)
        }
    }

    companion object {
        fun updateAppWidget(context: Context, manager: AppWidgetManager, appWidgetId: Int) {
            val views = RemoteViews(context.packageName, R.layout.widget_mining_quick)
            val snap = QuickCommandHandler.snapshot(
                mining = false,
                profileId = null,
                waitingReason = if (MiningSessionLatch.isUserStopped()) "Stop latched" else null
            )
            views.setTextViewText(
                R.id.widget_status,
                when {
                    snap.userStopLatched -> "Stopped"
                    snap.pauseUntilMs != null -> "Paused"
                    snap.automationArmed -> "Ready"
                    else -> "Automation off"
                }
            )
            views.setTextViewText(
                R.id.widget_detail,
                snap.waitingReason ?: QuickCommandHandler.lastAck.reason
            )

            val open = PendingIntent.getActivity(
                context,
                0,
                Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_root, open)

            val stop = PendingIntent.getBroadcast(
                context,
                1,
                QuickCommandReceiver.intent(context, "stop_mining", source = "widget"),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_stop, stop)

            val start = PendingIntent.getBroadcast(
                context,
                2,
                QuickCommandReceiver.intent(context, "start_profile", source = "widget"),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_start, start)

            manager.updateAppWidget(appWidgetId, views)
        }
    }
}
