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
        val validationError: String? = null,
        /** True when the on-screen draft differs from the last saved profile (#52). */
        val isDirty: Boolean = false,
        val showResetConfirm: Boolean = false,
        val showDiscardConfirm: Boolean = false,
        /** Why Save is disabled — null when save is allowed. */
        val saveBlockedReason: String? = null,
        /** Last solo daemon readiness probe (#44). TCP≠ready. */
        val daemonProbeStage: String? = null,
        val daemonProbeMessage: String? = null,
        val daemonProbeReady: Boolean = false,
        val daemonProbeCheckedAtEpochMs: Long? = null,
        val isProbingDaemon: Boolean = false
    ) : ConfigUiState
    data class Error(val message: String) : ConfigUiState
}

sealed interface ConfigUiEvent {
    data class CoinTypeChanged(val coinType: CoinType) : ConfigUiEvent
    data class PoolSelected(val pool: Pool) : ConfigUiEvent
    data class WalletAddressChanged(val address: String) : ConfigUiEvent
    data class WorkerNameChanged(val name: String) : ConfigUiEvent
    data class ThreadsChanged(val threads: Int) : ConfigUiEvent
    data class ThreadsAutoToggled(val enabled: Boolean) : ConfigUiEvent
    data class MaxCpuUsageChanged(val usage: Int) : ConfigUiEvent
    data class TlsToggled(val enabled: Boolean) : ConfigUiEvent
    data class CustomPoolUrlChanged(val url: String) : ConfigUiEvent
    data class SoloDaemonToggled(val enabled: Boolean) : ConfigUiEvent
    data class RequireExternalPowerToggled(val enabled: Boolean) : ConfigUiEvent
    data class PauseOnUnplugToggled(val enabled: Boolean) : ConfigUiEvent
    data class ChargeBeforeMineToggled(val enabled: Boolean) : ConfigUiEvent
    data class PauseOnNetDischargeToggled(val enabled: Boolean) : ConfigUiEvent
    data class DreamMayMineToggled(val enabled: Boolean) : ConfigUiEvent
    data class ManualWattsChanged(val watts: String) : ConfigUiEvent
    data class ElectricityRateChanged(val rate: String) : ConfigUiEvent
    data class DailySpendCapChanged(val amount: String) : ConfigUiEvent
    data class DailyKwhCapChanged(val kwh: String) : ConfigUiEvent
    /** Manual / save-time monerod RPC readiness check (#44). */
    data object ProbeDaemon : ConfigUiEvent
    data object SaveConfig : ConfigUiEvent
    /** User tapped Reset — ask before destroying drafts (#52). */
    data object RequestResetToDefaults : ConfigUiEvent
    data object ConfirmResetToDefaults : ConfigUiEvent
    data object CancelResetToDefaults : ConfigUiEvent
    /** System/top-bar back — guard unsaved drafts (#52). */
    data object RequestNavigateBack : ConfigUiEvent
    data object ConfirmDiscardAndNavigateBack : ConfigUiEvent
    data object CancelDiscardAndStay : ConfigUiEvent
}

sealed interface ConfigUiEffect {
    data object ConfigSaved : ConfigUiEffect
    data object NavigateBack : ConfigUiEffect
    data class ShowError(val message: String) : ConfigUiEffect
}
