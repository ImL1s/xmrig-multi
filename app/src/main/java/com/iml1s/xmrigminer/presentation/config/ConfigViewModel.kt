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
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.*
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
    private var availablePools: List<Pool> = emptyList()

    init {
        loadConfigAndPools()
    }

    private fun loadConfigAndPools() {
        viewModelScope.launch {
            try {
                availablePools = poolRepository.getPools()

                configRepository.getConfig().collect { config ->
                    currentConfig = config
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
                        filteredPools = filteredPools
                    )
                }
            } catch (e: Exception) {
                _uiState.value = ConfigUiState.Error(e.message ?: "Failed to load configuration")
            }
        }
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
            is ConfigUiEvent.ResetToDefaults -> handleResetToDefaults()
        }
    }

    private fun handleCoinTypeChanged(coinType: CoinType) {
        val state = _uiState.value as? ConfigUiState.Success ?: return
        val filteredPools = availablePools.filter { it.getCoinType() == coinType }
        val defaultPool = filteredPools.firstOrNull { it.isStartAllowed() } ?: filteredPools.firstOrNull()
        val enablingSolo = currentConfig.soloDaemon && coinType == CoinType.MONERO
        val defaultPoolUrl = when {
            enablingSolo -> currentConfig.poolUrl.ifBlank { MiningConfig.DEFAULT_SOLO_DAEMON_URL }
            else -> defaultPool?.takeIf { it.isStartAllowed() }?.getUrl(currentConfig.useTls)
                ?: if (coinType == CoinType.MONERO) MiningConfig.getDefaultPoolUrl(coinType) else ""
        }

        val newConfig = currentConfig.copy(
            coinType = coinType.name,
            poolUrl = defaultPoolUrl,
            walletAddress = "",  // 清空錢包地址，因為不同幣種格式不同
            soloDaemon = enablingSolo,
            useTls = if (enablingSolo) false else currentConfig.useTls
        )

        updateConfig(newConfig, state.copy(
            selectedCoinType = coinType,
            filteredPools = filteredPools,
            selectedPool = if (enablingSolo) null else defaultPool?.takeIf { it.isStartAllowed() },
            validationError = null
        ))
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
        val newConfig = currentConfig.copy(walletAddress = address.trim())
        val error = validateWalletAddress(address.trim(), state.selectedCoinType)
        updateConfig(newConfig, state.copy(validationError = error))
    }

    private fun handleWorkerNameChanged(name: String) {
        val state = _uiState.value as? ConfigUiState.Success ?: return
        val newConfig = currentConfig.copy(workerName = name)
        updateConfig(newConfig, state)
    }

    private fun handleThreadsChanged(threads: Int) {
        val state = _uiState.value as? ConfigUiState.Success ?: return
        val max = Runtime.getRuntime().availableProcessors().coerceAtLeast(1)
        val newConfig = currentConfig.copy(
            threads = threads.coerceIn(1, max),
            threadsAuto = false
        )
        updateConfig(newConfig, state)
    }

    private fun handleThreadsAutoToggled(enabled: Boolean) {
        val state = _uiState.value as? ConfigUiState.Success ?: return
        val newConfig = currentConfig.copy(threadsAuto = enabled)
        updateConfig(newConfig, state)
    }

    private fun handleMaxCpuUsageChanged(usage: Int) {
        val state = _uiState.value as? ConfigUiState.Success ?: return
        val newConfig = currentConfig.copy(maxCpuUsage = usage.coerceIn(10, 100))
        updateConfig(newConfig, state)
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
        val newConfig = currentConfig.copy(poolUrl = url)
        updateConfig(newConfig, state.copy(selectedPool = null))
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
        val newConfig = if (enabled) {
            currentConfig.copy(
                soloDaemon = true,
                useTls = false,
                coinType = CoinType.MONERO.name,
                poolUrl = when {
                    currentConfig.poolUrl.contains("18081") -> currentConfig.poolUrl
                    else -> MiningConfig.DEFAULT_SOLO_DAEMON_URL
                }
            )
        } else {
            val restored = availablePools
                .filter { it.getCoinType() == CoinType.MONERO }
                .firstOrNull()
            currentConfig.copy(
                soloDaemon = false,
                poolUrl = restored?.getUrl(false)
                    ?: MiningConfig.getDefaultPoolUrl(CoinType.MONERO)
            )
        }
        val selectedPool = if (enabled) {
            null
        } else {
            availablePools.find {
                it.url == newConfig.poolUrl || it.sslUrl == newConfig.poolUrl
            }
        }
        updateConfig(newConfig, state.copy(selectedPool = selectedPool))
    }

    private fun handleSaveConfig() {
        val state = _uiState.value as? ConfigUiState.Success ?: return

        if (!currentConfig.isValid()) {
            viewModelScope.launch {
                _uiEffect.send(ConfigUiEffect.ShowError("Please fill in all required fields"))
            }
            return
        }

        if (state.validationError != null) {
            viewModelScope.launch {
                _uiEffect.send(ConfigUiEffect.ShowError(state.validationError))
            }
            return
        }

        viewModelScope.launch {
            try {
                _uiState.value = state.copy(isValidating = true)
                configRepository.saveConfig(currentConfig)
                _uiEffect.send(ConfigUiEffect.ConfigSaved)
                _uiState.value = state.copy(isValidating = false)
            } catch (e: Exception) {
                _uiState.value = state.copy(isValidating = false)
                _uiEffect.send(ConfigUiEffect.ShowError(e.message ?: "Failed to save configuration"))
            }
        }
    }

    private fun handleResetToDefaults() {
        viewModelScope.launch {
            try {
                configRepository.clear()
                loadConfigAndPools()
            } catch (e: Exception) {
                _uiEffect.send(ConfigUiEffect.ShowError("Failed to reset configuration"))
            }
        }
    }

    private fun updateConfig(newConfig: MiningConfig, newState: ConfigUiState.Success) {
        currentConfig = newConfig
        _uiState.value = newState.copy(config = newConfig)
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
        // Monero primary address validation (starts with 4, length 95)
        if (address.startsWith("4") && address.length == 95) {
            return null
        }
        // Monero integrated address (starts with 8, length 106)
        if (address.startsWith("8") && address.length == 106) {
            return null
        }
        // Monero subaddress (starts with 8, length 95)
        if (address.startsWith("8") && address.length == 95) {
            return null
        }
        return "Invalid Monero wallet address (should start with 4 or 8)"
    }

    private fun validateWowneroAddress(address: String): String? {
        // Wownero addresses start with "Wo" and are ~95-97 characters
        if (address.startsWith("Wo") && address.length in 95..106) {
            return null
        }
        return "Invalid Wownero wallet address (should start with 'Wo')"
    }

    private fun validateDeroAddress(address: String): String? {
        // DERO addresses start with "dero" and are 66 characters
        if (address.startsWith("dero") && address.length >= 60) {
            return null
        }
        return "Invalid DERO wallet address (should start with 'dero')"
    }
}
