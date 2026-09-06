package com.iml1s.xmrigminer.presentation.config

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.iml1s.xmrigminer.data.model.CoinType
import com.iml1s.xmrigminer.data.model.MiningConfig
import com.iml1s.xmrigminer.data.model.Pool
import com.iml1s.xmrigminer.data.repository.ConfigRepository
import com.iml1s.xmrigminer.data.repository.PoolRepository
import com.iml1s.xmrigminer.native.XmrigNativeCapabilities
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ConfigViewModel @Inject constructor(
    private val configRepository: ConfigRepository,
    private val poolRepository: PoolRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow<ConfigUiState>(ConfigUiState.Loading)
    val uiState: StateFlow<ConfigUiState> = _uiState.asStateFlow()

    private val _uiEffect = Channel<ConfigUiEffect>()
    val uiEffect = _uiEffect.receiveAsFlow()

    private var currentConfig: MiningConfig = MiningConfig()
    private var savedConfig: MiningConfig = MiningConfig()
    private var availablePools: List<Pool> = emptyList()
    private val drafts = ConfigDraftCoordinator { availablePools }
    private var collectJob: Job? = null
    private var applyingRemote = false

    init {
        loadConfigAndPools()
    }

    private fun loadConfigAndPools() {
        viewModelScope.launch {
            try {
                availablePools = poolRepository.getPools()
                // One long-lived collector — Reset must not stack another (#52).
                if (collectJob == null) {
                    collectJob = launch {
                        configRepository.getConfig().collect { config ->
                            if (applyingRemote) return@collect
                            val state = _uiState.value as? ConfigUiState.Success
                            if (state != null && state.isDirty) {
                                savedConfig = config
                                _uiState.value = state.copy(
                                    isDirty = currentConfig != savedConfig,
                                    saveBlockedReason = saveBlockedReason(
                                        currentConfig,
                                        state.validationError
                                    )
                                )
                                return@collect
                            }
                            applySavedConfig(config)
                        }
                    }
                }
            } catch (e: Exception) {
                _uiState.value = ConfigUiState.Error(e.message ?: "Failed to load configuration")
            }
        }
    }

    private fun applySavedConfig(config: MiningConfig) {
        savedConfig = config
        currentConfig = config
        drafts.clear()
        drafts.stashFrom(config, null)
        val coinType = config.getCoin()
        val filteredPools = availablePools.filter { it.getCoinType() == coinType }
        val selectedPool = filteredPools.find { pool ->
            pool.url == config.poolUrl || pool.sslUrl == config.poolUrl
        }
        _uiState.value = ConfigUiState.Success(
            config = config,
            pools = availablePools,
            selectedPool = selectedPool,
            selectedCoinType = coinType,
            filteredPools = filteredPools,
            isDirty = false,
            saveBlockedReason = saveBlockedReason(config, null)
        )
    }

    fun onEvent(event: ConfigUiEvent) {
        when (event) {
            is ConfigUiEvent.CoinTypeChanged -> handleCoinTypeChanged(event.coinType)
            is ConfigUiEvent.PoolSelected -> handlePoolSelected(event.pool)
            is ConfigUiEvent.WalletAddressChanged -> handleWalletAddressChanged(event.address)
            is ConfigUiEvent.WorkerNameChanged -> handleWorkerNameChanged(event.name)
            is ConfigUiEvent.ThreadsChanged -> handleThreadsChanged(event.threads)
            is ConfigUiEvent.ThreadsAutoToggled -> handleThreadsAutoToggled(event.enabled)
            is ConfigUiEvent.MaxCpuUsageChanged -> handleMaxCpuUsageChanged(event.usage)
            is ConfigUiEvent.TlsToggled -> handleTlsToggled(event.enabled)
            is ConfigUiEvent.CustomPoolUrlChanged -> handleCustomPoolUrlChanged(event.url)
            is ConfigUiEvent.SoloDaemonToggled -> handleSoloDaemonToggled(event.enabled)
            is ConfigUiEvent.SaveConfig -> handleSaveConfig()
            is ConfigUiEvent.RequestResetToDefaults -> handleRequestReset()
            is ConfigUiEvent.ConfirmResetToDefaults -> handleConfirmReset()
            is ConfigUiEvent.CancelResetToDefaults -> handleCancelReset()
            is ConfigUiEvent.RequestNavigateBack -> handleRequestNavigateBack()
            is ConfigUiEvent.ConfirmDiscardAndNavigateBack -> handleConfirmDiscard()
            is ConfigUiEvent.CancelDiscardAndStay -> handleCancelDiscard()
        }
    }

    private fun handleCoinTypeChanged(coinType: CoinType) {
        val state = _uiState.value as? ConfigUiState.Success ?: return
        val (newConfig, selectedPool) = drafts.switchCoin(currentConfig, state.selectedPool, coinType)
        val filteredPools = availablePools.filter { it.getCoinType() == coinType }
        val error = if (newConfig.walletAddress.isBlank()) {
            null
        } else {
            validateWalletAddress(newConfig.walletAddress, coinType)
        }
        updateConfig(
            newConfig,
            state.copy(
                selectedCoinType = coinType,
                filteredPools = filteredPools,
                selectedPool = selectedPool,
                validationError = error
            )
        )
        XmrigNativeCapabilities.assertStartAllowed(coinType)?.let { reason ->
            viewModelScope.launch {
                _uiEffect.send(ConfigUiEffect.ShowError(reason))
            }
        }
    }

    private fun handlePoolSelected(pool: Pool) {
        val state = _uiState.value as? ConfigUiState.Success ?: return
        if (!pool.isStartAllowed()) {
            viewModelScope.launch {
                _uiEffect.send(
                    ConfigUiEffect.ShowError(pool.description.ifBlank { "Pool unavailable" })
                )
            }
            return
        }
        val newConfig = currentConfig.copy(
            poolUrl = pool.getUrl(currentConfig.useTls),
            coinType = pool.coin,
            soloDaemon = false
        )
        updateConfig(newConfig, state.copy(selectedPool = pool, validationError = null))
    }

    private fun handleWalletAddressChanged(address: String) {
        val state = _uiState.value as? ConfigUiState.Success ?: return
        val (parsed, warnings) = com.iml1s.xmrigminer.data.wallet.WalletAddressValidator.parseInput(address)
        if (parsed.isEmpty() && warnings.isNotEmpty()) {
            updateConfig(
                currentConfig.copy(walletAddress = address.trim()),
                state.copy(validationError = warnings.first())
            )
            return
        }
        val cleaned = parsed.ifBlank { address.trim() }
        val error = validateWalletAddress(cleaned, state.selectedCoinType)
        updateConfig(
            currentConfig.copy(walletAddress = cleaned),
            state.copy(validationError = error)
        )
    }

    private fun handleWorkerNameChanged(name: String) {
        val state = _uiState.value as? ConfigUiState.Success ?: return
        updateConfig(currentConfig.copy(workerName = name), state)
    }

    private fun handleThreadsChanged(threads: Int) {
        val state = _uiState.value as? ConfigUiState.Success ?: return
        val max = Runtime.getRuntime().availableProcessors().coerceAtLeast(1)
        updateConfig(
            currentConfig.copy(threads = threads.coerceIn(1, max), threadsAuto = false),
            state
        )
    }

    private fun handleThreadsAutoToggled(enabled: Boolean) {
        val state = _uiState.value as? ConfigUiState.Success ?: return
        updateConfig(currentConfig.copy(threadsAuto = enabled), state)
    }

    private fun handleMaxCpuUsageChanged(usage: Int) {
        val state = _uiState.value as? ConfigUiState.Success ?: return
        updateConfig(currentConfig.copy(maxCpuUsage = usage.coerceIn(10, 100)), state)
    }

    private fun handleTlsToggled(enabled: Boolean) {
        if (enabled && !XmrigNativeCapabilities.TLS_ENABLED) {
            viewModelScope.launch {
                _uiEffect.send(
                    ConfigUiEffect.ShowError(
                        "This Android XMRig build has no TLS. Use a plaintext pool port."
                    )
                )
            }
            return
        }
        val state = _uiState.value as? ConfigUiState.Success ?: return
        val pool = state.selectedPool ?: availablePools.find {
            it.url == currentConfig.poolUrl || it.sslUrl == currentConfig.poolUrl
        }
        val newConfig = if (pool != null) {
            currentConfig.copy(useTls = enabled, poolUrl = pool.getUrl(enabled))
        } else {
            currentConfig.copy(useTls = enabled)
        }
        updateConfig(newConfig, state.copy(selectedPool = pool ?: state.selectedPool))
    }

    private fun handleCustomPoolUrlChanged(url: String) {
        val state = _uiState.value as? ConfigUiState.Success ?: return
        updateConfig(currentConfig.copy(poolUrl = url), state.copy(selectedPool = null))
    }

    private fun handleSoloDaemonToggled(enabled: Boolean) {
        val state = _uiState.value as? ConfigUiState.Success ?: return
        if (enabled && state.selectedCoinType != CoinType.MONERO) {
            viewModelScope.launch {
                _uiEffect.send(
                    ConfigUiEffect.ShowError("Solo / daemon mining is Monero-only in this release")
                )
            }
            return
        }
        val (newConfig, selectedPool) = drafts.toggleSolo(currentConfig, state.selectedPool, enabled)
        updateConfig(newConfig, state.copy(selectedPool = selectedPool))
    }

    private fun handleSaveConfig() {
        val state = _uiState.value as? ConfigUiState.Success ?: return
        val blocked = saveBlockedReason(currentConfig, state.validationError)
        if (blocked != null) {
            viewModelScope.launch {
                _uiEffect.send(ConfigUiEffect.ShowError(blocked))
            }
            _uiState.value = state.copy(saveBlockedReason = blocked)
            return
        }

        viewModelScope.launch {
            try {
                _uiState.value = state.copy(isValidating = true)
                applyingRemote = true
                configRepository.saveConfig(currentConfig)
                savedConfig = currentConfig
                drafts.clear()
                drafts.stashFrom(currentConfig, state.selectedPool)
                _uiEffect.send(ConfigUiEffect.ConfigSaved)
                _uiState.value = state.copy(
                    isValidating = false,
                    isDirty = false,
                    saveBlockedReason = null,
                    config = currentConfig
                )
            } catch (e: Exception) {
                _uiState.value = state.copy(isValidating = false)
                _uiEffect.send(ConfigUiEffect.ShowError(e.message ?: "Failed to save configuration"))
            } finally {
                applyingRemote = false
            }
        }
    }

    private fun handleRequestReset() {
        val state = _uiState.value as? ConfigUiState.Success ?: return
        _uiState.value = state.copy(showResetConfirm = true)
    }

    private fun handleCancelReset() {
        val state = _uiState.value as? ConfigUiState.Success ?: return
        _uiState.value = state.copy(showResetConfirm = false)
    }

    private fun handleConfirmReset() {
        viewModelScope.launch {
            try {
                applyingRemote = true
                configRepository.clear()
                drafts.clear()
                val defaults = configRepository.getConfig().first()
                applyingRemote = false
                applySavedConfig(defaults)
            } catch (e: Exception) {
                applyingRemote = false
                _uiEffect.send(ConfigUiEffect.ShowError("Failed to reset configuration"))
            }
        }
    }

    private fun handleRequestNavigateBack() {
        val state = _uiState.value as? ConfigUiState.Success
        if (state == null || !state.isDirty) {
            viewModelScope.launch { _uiEffect.send(ConfigUiEffect.NavigateBack) }
            return
        }
        _uiState.value = state.copy(showDiscardConfirm = true)
    }

    private fun handleConfirmDiscard() {
        viewModelScope.launch {
            currentConfig = savedConfig
            drafts.clear()
            applySavedConfig(savedConfig)
            _uiEffect.send(ConfigUiEffect.NavigateBack)
        }
    }

    private fun handleCancelDiscard() {
        val state = _uiState.value as? ConfigUiState.Success ?: return
        _uiState.value = state.copy(showDiscardConfirm = false)
    }

    private fun updateConfig(newConfig: MiningConfig, newState: ConfigUiState.Success) {
        currentConfig = newConfig
        drafts.stashFrom(newConfig, newState.selectedPool)
        _uiState.value = newState.copy(
            config = newConfig,
            isDirty = newConfig != savedConfig,
            saveBlockedReason = saveBlockedReason(newConfig, newState.validationError)
        )
    }

    internal fun saveBlockedReason(config: MiningConfig, validationError: String?): String? {
        if (validationError != null) return validationError
        if (config.walletAddress.isBlank()) return "Wallet address is required"
        if (config.poolUrl.isBlank()) return "Pool / daemon endpoint is required"
        if (!config.threadsAuto && config.threads <= 0) return "Thread count must be at least 1"
        if (config.maxCpuUsage !in 10..100) return "Thread hint must be between 10 and 100"
        if (config.soloDaemon && config.getCoin() != CoinType.MONERO) {
            return "Solo / daemon mining is Monero-only in this release"
        }
        if (config.soloDaemon) {
            val daemon = com.iml1s.xmrigminer.data.daemon.DaemonEndpoint.parse(config.poolUrl)
            if (!daemon.ok) {
                return daemon.error ?: "Invalid solo daemon URL"
            }
        }
        XmrigNativeCapabilities.assertStartAllowed(config.getCoin())?.let { return it }
        return null
    }

    private fun validateWalletAddress(address: String, coinType: CoinType): String? {
        if (address.isBlank()) return "Wallet address is required"
        return when (coinType) {
            CoinType.MONERO -> validateMoneroAddress(address)
            CoinType.WOWNERO -> validateWowneroAddress(address)
            CoinType.DERO -> validateDeroAddress(address)
        }
    }

    private fun validateMoneroAddress(address: String): String? {
        val r = com.iml1s.xmrigminer.data.wallet.WalletAddressValidator.validate(address, "monero")
        return if (r.ok) null else r.message
    }

    private fun validateWowneroAddress(address: String): String? {
        val r = com.iml1s.xmrigminer.data.wallet.WalletAddressValidator.validate(address, "wownero")
        return if (r.ok) null else r.message
    }

    private fun validateDeroAddress(address: String): String? {
        val r = com.iml1s.xmrigminer.data.wallet.WalletAddressValidator.validate(address, "dero")
        return if (r.ok) null else r.message
    }
}
