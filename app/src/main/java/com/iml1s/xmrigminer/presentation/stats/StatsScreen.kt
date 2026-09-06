package com.iml1s.xmrigminer.presentation.stats

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.iml1s.xmrigminer.data.model.MiningStats
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StatsScreen(
    viewModel: StatsViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Statistics") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        StatsContent(
            modifier = Modifier.padding(padding),
            stats = uiState.stats,
            isRunning = uiState.isRunning
        )
    }
}

@Composable
private fun StatsContent(
    modifier: Modifier = Modifier,
    stats: MiningStats,
    isRunning: Boolean
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(
            text = if (isRunning) "Mining" else "Stopped",
            style = MaterialTheme.typography.titleMedium,
            color = if (isRunning) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
        )

        StatsCard(title = "Hashrate") {
            StatsRow("10s", formatHs(stats.hashrate10s))
            StatsRow("60s", formatHs(stats.hashrate60s))
            StatsRow("15m", formatHs(stats.hashrate15m))
        }

        StatsCard(title = "Shares") {
            StatsRow("Accepted", stats.acceptedShares.toString())
            StatsRow("Rejected", stats.rejectedShares.toString())
            StatsRow("Success rate", "%.1f%%".format(stats.successRate))
            StatsRow("Difficulty", if (stats.difficulty == 0L) "-" else stats.difficulty.toString())
        }

        StatsCard(title = "Device") {
            StatsRow("CPU", if (stats.cpuUsage > 0f) "${stats.cpuUsage.roundToInt()}%" else "-")
            StatsRow("Temperature", if (stats.temperature > 0) "%.1f°C".format(stats.temperature) else "-")
            StatsRow("Battery", "${stats.batteryLevel}%${if (stats.isCharging) " charging" else ""}")
        }

        StatsCard(title = "Energy today") {
            StatsRow(
                "kWh",
                stats.energyKwhToday?.let { "%.4f".format(it) } ?: "unknown"
            )
            StatsRow(
                "Cost",
                stats.energyFiatToday?.let { "%.4f %s".format(it, stats.energyCurrency) }
                    ?: "unknown"
            )
            StatsRow("Quality", stats.energyQuality)
            StatsRow("Source", stats.energySourceLabel)
        }
    }
}

@Composable
private fun StatsCard(
    title: String,
    content: @Composable () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            content()
        }
    }
}

@Composable
private fun StatsRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
    }
}

private fun formatHs(value: Double): String {
    return if (value > 0) "%.2f H/s".format(value) else "-"
}
