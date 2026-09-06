package com.iml1s.xmrigminer.service.quick

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * In-app notification / widget actions only — not exported for arbitrary apps (#79).
 */
class QuickCommandReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val type = intent?.getStringExtra(EXTRA_TYPE) ?: return
        val pauseFor = intent.getLongExtra(EXTRA_PAUSE_MS, -1L).takeIf { it > 0 }
        QuickCommandHandler.handle(
            context = context.applicationContext,
            type = type,
            pauseForMs = pauseFor,
            source = intent.getStringExtra(EXTRA_SOURCE) ?: "notification",
            authorized = true
        )
    }

    companion object {
        const val ACTION = "com.iml1s.xmrigminer.action.QUICK_COMMAND"
        const val EXTRA_TYPE = "type"
        const val EXTRA_PAUSE_MS = "pause_for_ms"
        const val EXTRA_SOURCE = "source"

        fun intent(context: Context, type: String, pauseForMs: Long? = null, source: String): Intent {
            return Intent(context, QuickCommandReceiver::class.java).apply {
                action = ACTION
                putExtra(EXTRA_TYPE, type)
                putExtra(EXTRA_SOURCE, source)
                if (pauseForMs != null) putExtra(EXTRA_PAUSE_MS, pauseForMs)
            }
        }
    }
}
