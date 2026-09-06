package com.iml1s.xmrigminer.wear

import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import com.google.android.gms.tasks.Tasks
import com.iml1s.xmrigminer.data.repository.ConfigRepository
import com.iml1s.xmrigminer.service.MiningController
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import org.json.JSONObject
import timber.log.Timber
import javax.inject.Inject

/**
 * Wear remote commands with ack + expiry / Stop-latch checks (#62).
 */
@AndroidEntryPoint
class WearMessageService : WearableListenerService() {

    @Inject
    lateinit var miningController: MiningController

    @Inject
    lateinit var wearStatsSyncer: WearStatsSyncer

    @Inject
    lateinit var configRepository: ConfigRepository

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onMessageReceived(messageEvent: MessageEvent) {
        when (messageEvent.path) {
            WearPaths.START, WearPaths.STOP -> scope.launch {
                handleCommand(messageEvent)
            }
            WearPaths.REQUEST_STATS -> {
                Timber.d("Wear requested stats refresh")
                wearStatsSyncer.publishNow()
            }
            else -> super.onMessageReceived(messageEvent)
        }
    }

    private suspend fun handleCommand(messageEvent: MessageEvent) {
        val now = System.currentTimeMillis()
        val type = if (messageEvent.path == WearPaths.START) "start" else "stop"
        val parsed = parseEnvelope(messageEvent.data, type, now)
        val config = configRepository.getConfig().first()
        val missingConfig = config.walletAddress.isBlank() && type == "start"
        val result = CompanionCommandPolicy.receive(
            command = parsed,
            nowMs = now,
            paired = true,
            authenticated = true,
            reachable = true,
            phoneSessionId = wearStatsSyncer.sessionId,
            missingConfig = missingConfig,
            // Explicit watch Start is a new user action — do not treat Stop latch as block.
            // Latch still prevents silent reconnect revival via power/automation paths.
            userStopLatched = false
        )

        replyAck(messageEvent.sourceNodeId, parsed.commandId, result)

        if (!result.apply) {
            Timber.i("Wear %s rejected: %s", type, result.reason)
            return
        }

        when (type) {
            "start" -> {
                Timber.i("Wear start accepted id=%s", parsed.commandId)
                miningController.start()
            }
            "stop" -> {
                Timber.i("Wear stop accepted id=%s", parsed.commandId)
                wearStatsSyncer.markUserStopFromCompanion()
                miningController.stop()
            }
        }
        wearStatsSyncer.publishNow()
        replyAck(
            messageEvent.sourceNodeId,
            parsed.commandId,
            CompanionCommandPolicy.ReceiveResult(
                CompanionCommandPolicy.Ack.COMPLETED,
                "Completed",
                apply = false
            )
        )
    }

    private fun parseEnvelope(data: ByteArray?, type: String, now: Long): CompanionCommandPolicy.Command {
        if (data == null || data.isEmpty()) {
            return CompanionCommandPolicy.Command(
                commandId = "legacy-$now",
                type = type,
                targetDeviceId = "phone",
                sessionId = wearStatsSyncer.sessionId,
                issuedAtMs = now,
                expiresAtMs = now + CompanionCommandPolicy.DEFAULT_TTL_MS
            )
        }
        return try {
            val json = JSONObject(String(data, Charsets.UTF_8))
            // Scrub — ignore any secret-looking keys if a watch sent them by mistake.
            val keys = json.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                if (CompanionCommandPolicy.containsSecretKey(k)) {
                    Timber.w("Dropping secret key from wear payload: %s", k)
                }
            }
            CompanionCommandPolicy.Command(
                commandId = json.optString("commandId", "legacy-$now"),
                type = type,
                targetDeviceId = json.optString("targetDeviceId", "phone"),
                profileId = if (json.has("profileId")) json.optString("profileId") else null,
                sessionId = if (json.has("sessionId")) json.optString("sessionId") else wearStatsSyncer.sessionId,
                issuedAtMs = json.optLong("issuedAtMs", now),
                expiresAtMs = json.optLong("expiresAtMs", now + CompanionCommandPolicy.DEFAULT_TTL_MS)
            )
        } catch (e: Exception) {
            Timber.d(e, "Wear command payload not JSON — treating as legacy")
            CompanionCommandPolicy.Command(
                commandId = "legacy-$now",
                type = type,
                targetDeviceId = "phone",
                sessionId = wearStatsSyncer.sessionId,
                issuedAtMs = now,
                expiresAtMs = now + CompanionCommandPolicy.DEFAULT_TTL_MS
            )
        }
    }

    private fun replyAck(
        nodeId: String,
        commandId: String,
        result: CompanionCommandPolicy.ReceiveResult
    ) {
        try {
            val body = JSONObject()
                .put("commandId", commandId)
                .put("ack", result.ack.name.lowercase())
                .put("reason", result.reason)
                .toString()
                .toByteArray(Charsets.UTF_8)
            Tasks.await(Wearable.getMessageClient(this).sendMessage(nodeId, WearPaths.ACK, body))
        } catch (e: Exception) {
            Timber.d(e, "Wear ack send skipped")
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
