package com.iml1s.xmrigminer.service

import android.content.Context
import android.content.SharedPreferences

/**
 * SharedPreferences-backed session intent store (#124).
 * Survives process death so UserStopped is not silently cleared on relaunch.
 */
class PrefsSessionIntentStore(
    context: Context,
    prefsName: String = PREFS_NAME
) : SessionIntentStore {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(prefsName, Context.MODE_PRIVATE)

    override fun load(): PersistedSessionIntent {
        return PersistedSessionIntent(
            userStopRevision = prefs.getInt(KEY_USER_STOP, 0),
            sessionArmedRevision = prefs.getInt(KEY_ARMED, 0),
            automationArmed = prefs.getBoolean(KEY_AUTOMATION, false)
        )
    }

    override fun save(intent: PersistedSessionIntent) {
        // commit(): UserStopped must survive immediate process kill (#124).
        prefs.edit()
            .putInt(KEY_USER_STOP, intent.userStopRevision)
            .putInt(KEY_ARMED, intent.sessionArmedRevision)
            .putBoolean(KEY_AUTOMATION, intent.automationArmed)
            .commit()
    }

    companion object {
        const val PREFS_NAME = "mining_session_intent"
        private const val KEY_USER_STOP = "user_stop_revision"
        private const val KEY_ARMED = "session_armed_revision"
        private const val KEY_AUTOMATION = "automation_armed"
    }
}
