package com.iml1s.xmrigminer.presentation.config

import com.iml1s.xmrigminer.data.model.CoinType
import com.iml1s.xmrigminer.data.model.MiningConfig
import com.iml1s.xmrigminer.data.model.Pool

sealed interface ConfigUiState {
    data object Loading : ConfigUiState
    data class Success(
        val config: MiningConfig,
        val pools: List<Pool>,
        val selectedPool: Pool?,
        val selectedCoinType: CoinType = CoinType.MONERO,
        val filteredPools: List<Pool> = pools.filter { it.getCoinType() == CoinType.MONERO },
        val isValidating: Boolean = false,
        val validationError: String? = null
    ) : ConfigUiState
    data class Error(val message: String) : ConfigUiState
}

sealed interface ConfigUiEvent {
    data class CoinTypeChanged(val coinType: CoinType) : ConfigUiEvent
    data class PoolSelected(val pool: Pool) : ConfigUiEvent
    data class WalletAddressChanged(val address: String) : ConfigUiEvent
    data class WorkerNameChanged(val name: String) : ConfigUiEvent
    data class ThreadsChanged(val threads: Int) : ConfigUiEvent
    data class MaxCpuUsageChanged(val usage: Int) : ConfigUiEvent
    data class TlsToggled(val enabled: Boolean) : ConfigUiEvent
    data class CustomPoolUrlChanged(val url: String) : ConfigUiEvent
    data class SoloDaemonToggled(val enabled: Boolean) : ConfigUiEvent
    data object SaveConfig : ConfigUiEvent
    data object ResetToDefaults : ConfigUiEvent
}

sealed interface ConfigUiEffect {
    data object ConfigSaved : ConfigUiEffect
    data class ShowError(val message: String) : ConfigUiEffect
}
