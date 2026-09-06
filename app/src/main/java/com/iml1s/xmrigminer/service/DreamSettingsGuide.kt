package com.iml1s.xmrigminer.service

/**
 * Settings copy + intents for DreamService (#76).
 */
object DreamSettingsGuide {
    const val ACTION_DREAM_SETTINGS = "android.settings.DREAM_SETTINGS"
    const val TITLE = "Charging screensaver"
    const val BODY =
        "Pick XMRig Multi in system screensaver settings while charging. " +
            "Preview never mines. Opt-in clock+mine still respects Stop, power, and OS eligibility."

    fun unsupportedFallback(): String =
        "This device has no screensaver settings entry. Use the in-app ambient clock instead."
}
