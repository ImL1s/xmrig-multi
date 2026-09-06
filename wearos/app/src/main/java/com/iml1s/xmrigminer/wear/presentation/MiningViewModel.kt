package com.iml1s.xmrigminer.wear.presentation

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.android.gms.wearable.*
import com.google.android.gms.tasks.Tasks
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

data class MiningState(
    val isRunning: Boolean = false,
    val isConnected: Boolean = false,
    val hashrate: Double = 0.0,
    val sharesAccepted: Long = 0,
    val sharesRejected: Long = 0,
    val difficulty: Long = 0,
    val uptime: Long = 0,
    val coinType: String = "XMR",
    val poolName: String = "",
    val syncQuality: String = "offline",
    val syncLabel: String = "Offline — last numbers are not live",
    val lastSyncAtMs: Long? = null,
    val sessionId: String? = null,
    val sourceDeviceId: String? = null,
    val commandPending: Boolean = false,
    val lastAck: String? = null,
    val lastAckReason: String? = null
)

class MiningViewModel(application: Application) : AndroidViewModel(application) {

    private val _state = MutableStateFlow(MiningState())
    val state: StateFlow<MiningState> = _state.asStateFlow()

    private val dataClient: DataClient = Wearable.getDataClient(application)
    private val messageClient: MessageClient = Wearable.getMessageClient(application)
    private val nodeClient: NodeClient = Wearable.getNodeClient(application)

    private val messageListener = MessageClient.OnMessageReceivedListener { event ->
        if (event.path == PATH_ACK) {
            try {
                val json = JSONObject(String(event.data, Charsets.UTF_8))
                _state.value = _state.value.copy(
                    commandPending = false,
                    lastAck = json.optString("ack"),
                    lastAckReason = json.optString("reason")
                )
            } catch (_: Exception) {
                _state.value = _state.value.copy(commandPending = false, lastAck = "error")
            }
        }
    }

    init {
        setupDataListener()
        messageClient.addListener(messageListener)
        refreshStats()
        reclassifySync()
    }

    private fun setupDataListener() {
        dataClient.addListener { dataEvents ->
            dataEvents.forEach { event ->
                if (event.type == DataEvent.TYPE_CHANGED) {
                    val dataItem = event.dataItem
                    when (dataItem.uri.path) {
                        PATH_MINING_STATS -> {
                            val dataMap = DataMapItem.fromDataItem(dataItem).dataMap
                            updateStats(dataMap)
                        }
                    }
                }
            }
        }
    }

    private fun updateStats(dataMap: DataMap) {
        val syncAt = if (dataMap.containsKey("syncAt")) dataMap.getLong("syncAt") else System.currentTimeMillis()
        val quality = classifyLocal(
            connected = true,
            lastSyncAtMs = syncAt
        )
        val showLive = quality.first == "live"
        val running = dataMap.getBoolean("isRunning", false)
        _state.value = _state.value.copy(
            isRunning = if (showLive) running else false,
            hashrate = dataMap.getDouble("hashrate", 0.0),
            sharesAccepted = dataMap.getLong("sharesAccepted", 0),
            sharesRejected = dataMap.getLong("sharesRejected", 0),
            difficulty = dataMap.getLong("difficulty", 0),
            uptime = dataMap.getLong("uptime", 0),
            coinType = dataMap.getString("coinType", "XMR") ?: "XMR",
            poolName = dataMap.getString("poolName", "") ?: "",
            isConnected = true,
            lastSyncAtMs = syncAt,
            sessionId = dataMap.getString("sessionId"),
            sourceDeviceId = dataMap.getString("sourceDeviceId") ?: "android-phone",
            syncQuality = quality.first,
            syncLabel = quality.second
        )
    }

    private fun classifyLocal(connected: Boolean, lastSyncAtMs: Long?): Pair<String, String> {
        if (!connected || lastSyncAtMs == null) {
            return "offline" to "Offline — last numbers are not live"
        }
        val age = System.currentTimeMillis() - lastSyncAtMs
        if (age > STALE_AFTER_MS) {
            return "stale" to "Stale (${age / 1000}s ago)"
        }
        return "live" to "Live"
    }

    private fun reclassifySync() {
        viewModelScope.launch {
            while (true) {
                kotlinx.coroutines.delay(5_000)
                val s = _state.value
                val q = classifyLocal(s.isConnected, s.lastSyncAtMs)
                if (q.first != s.syncQuality) {
                    _state.value = s.copy(
                        syncQuality = q.first,
                        syncLabel = q.second,
                        isRunning = if (q.first == "live") s.isRunning else false
                    )
                }
            }
        }
    }

    fun startMining() {
        sendCommand("start")
    }

    fun stopMining() {
        sendCommand("stop")
    }

    fun refreshStats() {
        sendMessageToPhone(MSG_REQUEST_STATS)
    }

    private fun sendCommand(type: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(commandPending = true, lastAck = null, lastAckReason = null)
            val now = System.currentTimeMillis()
            val body = JSONObject()
                .put("commandId", "wear-$now")
                .put("type", type)
                .put("targetDeviceId", "phone")
                .put("sessionId", _state.value.sessionId)
                .put("issuedAtMs", now)
                .put("expiresAtMs", now + 60_000)
                .toString()
                .toByteArray(Charsets.UTF_8)
            val path = if (type == "start") MSG_START_MINING else MSG_STOP_MINING
            sendMessageToPhone(path, body)
        }
    }

    private fun sendMessageToPhone(path: String, data: ByteArray = ByteArray(0)) {
        viewModelScope.launch {
            try {
                val nodes = withContext(Dispatchers.IO) {
                    Tasks.await(nodeClient.connectedNodes)
                }
                if (nodes.isNotEmpty()) {
                    val phoneNode = nodes.first()
                    withContext(Dispatchers.IO) {
                        Tasks.await(messageClient.sendMessage(phoneNode.id, path, data))
                    }
                    _state.value = _state.value.copy(isConnected = true)
                } else {
                    _state.value = _state.value.copy(
                        isConnected = false,
                        commandPending = false,
                        syncQuality = "offline",
                        syncLabel = "Offline — command not delivered",
                        lastAck = "undelivered",
                        lastAckReason = "Phone unreachable — stop not guaranteed"
                    )
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    isConnected = false,
                    commandPending = false,
                    syncQuality = "offline",
                    syncLabel = "Offline — last numbers are not live"
                )
            }
        }
    }

    override fun onCleared() {
        messageClient.removeListener(messageListener)
        super.onCleared()
    }

    companion object {
        private const val PATH_MINING_STATS = "/mining/stats"
        private const val PATH_ACK = "/mining/ack"
        private const val MSG_START_MINING = "/mining/start"
        private const val MSG_STOP_MINING = "/mining/stop"
        private const val MSG_REQUEST_STATS = "/mining/request_stats"
        private const val STALE_AFTER_MS = 45_000L
    }
}
