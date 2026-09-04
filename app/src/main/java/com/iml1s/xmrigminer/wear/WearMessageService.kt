package com.iml1s.xmrigminer.wear

import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import com.iml1s.xmrigminer.service.MiningController
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@AndroidEntryPoint
class WearMessageService : WearableListenerService() {

    @Inject
    lateinit var miningController: MiningController

    @Inject
    lateinit var wearStatsSyncer: WearStatsSyncer

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onMessageReceived(messageEvent: MessageEvent) {
        when (messageEvent.path) {
            WearPaths.START -> scope.launch {
                Timber.i("Wear requested start")
                miningController.start()
            }
            WearPaths.STOP -> {
                Timber.i("Wear requested stop")
                miningController.stop()
            }
            WearPaths.REQUEST_STATS -> {
                Timber.d("Wear requested stats refresh")
                wearStatsSyncer.publishNow()
            }
            else -> super.onMessageReceived(messageEvent)
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
