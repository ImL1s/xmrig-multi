package com.iml1s.xmrigminer.wear.data

import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService

/**
 * Receives messages from the phone while the Wear UI is in the background.
 * Live stats still arrive through the Data Layer (`/mining/stats`).
 */
class PhoneListenerService : WearableListenerService() {
    override fun onMessageReceived(messageEvent: MessageEvent) {
        super.onMessageReceived(messageEvent)
    }
}
