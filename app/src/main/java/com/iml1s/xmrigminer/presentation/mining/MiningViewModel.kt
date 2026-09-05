package com.iml1s.xmrigminer.presentation.mining

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.iml1s.xmrigminer.data.repository.StatsRepository
import com.iml1s.xmrigminer.service.MiningController
import com.iml1s.xmrigminer.service.MiningStartResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@HiltViewModel
class MiningViewModel @Inject constructor(
    private val statsRepository: StatsRepository,
    private val miningController: MiningController
) : ViewModel() {

    private val _uiState = MutableStateFlow(MiningUiState())
    val uiState: StateFlow<MiningUiState> = _uiState.asStateFlow()

    private val _effects = Channel<MiningEffect>(Channel.BUFFERED)
    val effects: Flow<MiningEffect> = _effects.receiveAsFlow()

    init {
        observeStats()
        observeWorkInfo()
    }

    private fun observeStats() {
        viewModelScope.launch {
            statsRepository.stats.collect { stats ->
                _uiState.update { it.copy(stats = stats) }
            }
        }
    }

    private fun observeWorkInfo() {
        viewModelScope.launch {
            miningController.isRunning().collect { isRunning ->
                _uiState.update { it.copy(isRunning = isRunning) }
            }
        }
    }

    fun onEvent(event: MiningEvent) {
        when (event) {
            is MiningEvent.StartMining -> startMining()
            is MiningEvent.StopMining -> stopMining()
            is MiningEvent.ClearError -> clearError()
            is MiningEvent.ClearLogs -> clearLogs()
        }
    }

    private fun startMining() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            try {
                when (val result = miningController.start()) {
                    is MiningStartResult.InvalidConfig -> {
                        Timber.w(result.message)
                        _uiState.update { it.copy(error = result.message) }
                        _effects.send(MiningEffect.NavigateToConfig(result.message))
                    }
                    MiningStartResult.Started -> {
                        _effects.send(MiningEffect.ShowToast("挖礦已啟動"))
                    }
                }
            } catch (e: Exception) {
                Timber.e(e, "Failed to start mining")
                _uiState.update { it.copy(error = "啟動失敗: ${e.message}") }
                _effects.send(MiningEffect.ShowToast("啟動失敗"))
            } finally {
                _uiState.update { it.copy(isLoading = false) }
            }
        }
    }

    private fun stopMining() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            try {
                miningController.stop()
                _effects.send(MiningEffect.ShowToast("挖礦已停止"))
            } catch (e: Exception) {
                Timber.e(e, "Failed to stop mining")
                _uiState.update { it.copy(error = "停止失敗: ${e.message}") }
            } finally {
                _uiState.update { it.copy(isLoading = false) }
            }
        }
    }

    private fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    private fun clearLogs() {
        _uiState.update { it.copy(logs = emptyList()) }
    }
}
