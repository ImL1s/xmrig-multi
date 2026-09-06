package com.iml1s.xmrigminer.util

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import androidx.core.app.NotificationCompat
import com.iml1s.xmrigminer.R
import com.iml1s.xmrigminer.service.MiningWorker
import com.iml1s.xmrigminer.service.quick.QuickCommandReceiver

object NotificationHelper {

    private const val WARNING_NOTIFICATION_ID = 2001

    fun showWarning(context: Context, message: String) {
        val stop = PendingIntent.getBroadcast(
            context,
            10,
            QuickCommandReceiver.intent(context, "stop_mining", source = "notification"),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val disableAuto = PendingIntent.getBroadcast(
            context,
            11,
            QuickCommandReceiver.intent(context, "disable_automation", source = "notification"),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val pause = PendingIntent.getBroadcast(
            context,
            12,
            QuickCommandReceiver.intent(
                context,
                "pause_for",
                pauseForMs = 15 * 60_000L,
                source = "notification"
            ),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, MiningWorker.CHANNEL_ID)
            .setContentTitle("Mining Paused")
            .setContentText(message)
            .setSmallIcon(R.drawable.ic_mining)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .addAction(0, context.getString(R.string.notif_action_stop_mining), stop)
            .addAction(0, context.getString(R.string.notif_action_disable_automation), disableAuto)
            .addAction(0, context.getString(R.string.notif_action_pause_15), pause)
            .build()

        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(WARNING_NOTIFICATION_ID, notification)
    }

    fun cancelWarning(context: Context) {
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.cancel(WARNING_NOTIFICATION_ID)
    }
}
