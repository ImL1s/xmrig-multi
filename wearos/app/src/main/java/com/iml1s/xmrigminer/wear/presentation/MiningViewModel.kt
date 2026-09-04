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

data class MiningState(
    val isRunning: Boolean = false,
    val isConnected: Boolean = false,
    val hashrate: Double = 0.0,
    val sharesAccepted: Long = 0,
    val sharesRejected: Long = 0,
    val difficulty: Long = 0,
    val uptime: Long = 0,
    val coinType: String = "XMR",
    val poolName: String = ""
)

class MiningViewModel(application: Application) : AndroidViewModel(application) {

    private val _state = MutableStateFlow(MiningState())
    val state: StateFlow<MiningState> = _state.asStateFlow()

    private val dataClient: DataClient = Wearable.getDataClient(application)
    private val messageClient: MessageClient = Wearable.getMessageClient(application)
    private val nodeClient: NodeClient = Wearable.getNodeClient(application)

    init {
        setupDataListener()
        refreshStats()
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
        _state.value = _state.value.copy(
            isRunning = dataMap.getBoolean("isRunning", false),
            hashrate = dataMap.getDouble("hashrate", 0.0),
            sharesAccepted = dataMap.getLong("sharesAccepted", 0),
            sharesRejected = dataMap.getLong("sharesRejected", 0),
            difficulty = dataMap.getLong("difficulty", 0),
            uptime = dataMap.getLong("uptime", 0),
            coinType = dataMap.getString("coinType", "XMR"),
            poolName = dataMap.getString("poolName", ""),
            isConnected = true
        )
    }

    fun startMining() {
        sendMessageToPhone(MSG_START_MINING)
    }

    fun stopMining() {
        sendMessageToPhone(MSG_STOP_MINING)
    }

    fun refreshStats() {
        sendMessageToPhone(MSG_REQUEST_STATS)
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
                    _state.value = _state.value.copy(isConnected = false)
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(isConnected = false)
            }
        }
    }

    companion object {
        private const val PATH_MINING_STATS = "/mining/stats"
        private const val MSG_START_MINING = "/mining/start"
        private const val MSG_STOP_MINING = "/mining/stop"
        private const val MSG_REQUEST_STATS = "/mining/request_stats"
    }
}
