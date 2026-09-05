package com.iml1s.xmrigminer.presentation.stats

import com.iml1s.xmrigminer.data.model.MiningStats

data class StatsUiState(
    val stats: MiningStats = MiningStats(),
    val isRunning: Boolean = false
)
