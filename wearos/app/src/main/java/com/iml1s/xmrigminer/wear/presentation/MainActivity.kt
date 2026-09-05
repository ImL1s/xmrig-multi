package com.iml1s.xmrigminer.wear.presentation

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.wear.compose.material.*
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState

/**
 * XMRig Multi WearOS - Companion App
 *
 * Features:
 * - View mining stats from phone
 * - Start/Stop mining remotely
 * - Tile for quick stats view
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MinerWearApp()
        }
    }
}

@Composable
fun MinerWearApp(viewModel: MiningViewModel = viewModel()) {
    val state by viewModel.state.collectAsState()

    MaterialTheme {
        MiningScreen(
            state = state,
            onStartMining = { viewModel.startMining() },
            onStopMining = { viewModel.stopMining() },
            onRefresh = { viewModel.refreshStats() }
        )
    }
}

@Composable
fun MiningScreen(
    state: MiningState,
    onStartMining: () -> Unit,
    onStopMining: () -> Unit,
    onRefresh: () -> Unit
) {
    val listState = rememberScalingLazyListState()

    Scaffold(
        timeText = { TimeText() },
        vignette = { Vignette(vignettePosition = VignettePosition.TopAndBottom) },
        positionIndicator = { PositionIndicator(scalingLazyListState = listState) }
    ) {
        ScalingLazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // Status Header
            item {
                StatusChip(isRunning = state.isRunning)
            }

            // Hashrate (Main Stat)
            item {
                HashrateCard(hashrate = state.hashrate)
            }

            // Stats Row
            item {
                StatsRow(
                    accepted = state.sharesAccepted,
                    rejected = state.sharesRejected,
                    uptime = state.uptime
                )
            }

            // Control Button
            item {
                Spacer(modifier = Modifier.height(8.dp))
                if (state.isRunning) {
                    Button(
                        onClick = onStopMining,
                        colors = ButtonDefaults.buttonColors(
                            backgroundColor = Color(0xFFEF4444)
                        ),
                        modifier = Modifier.fillMaxWidth(0.8f)
                    ) {
                        Text("Stop", fontWeight = FontWeight.Bold)
                    }
                } else {
                    Button(
                        onClick = onStartMining,
                        colors = ButtonDefaults.buttonColors(
                            backgroundColor = Color(0xFF7C3AED)
                        ),
                        modifier = Modifier.fillMaxWidth(0.8f)
                    ) {
                        Text("Start Mining", fontWeight = FontWeight.Bold)
                    }
                }
            }

            // Connection Status
            item {
                Text(
                    text = if (state.isConnected) "📱 Connected to phone" else "📱 Searching for phone...",
                    fontSize = 10.sp,
                    color = Color.Gray,
                    textAlign = TextAlign.Center
                )
            }
        }
    }
}

@Composable
fun StatusChip(isRunning: Boolean) {
    Chip(
        onClick = { },
        label = {
            Text(
                text = if (isRunning) "Mining" else "Stopped",
                fontWeight = FontWeight.Bold
            )
        },
        icon = {
            Text(
                text = if (isRunning) "🟢" else "⚪",
                fontSize = 14.sp
            )
        },
        colors = ChipDefaults.chipColors(
            backgroundColor = if (isRunning)
                Color(0xFF10B981).copy(alpha = 0.3f)
            else
                Color.DarkGray
        ),
        modifier = Modifier.fillMaxWidth(0.9f)
    )
}

@Composable
fun HashrateCard(hashrate: Double) {
    Card(
        onClick = { },
        modifier = Modifier.fillMaxWidth(0.9f)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(vertical = 12.dp)
        ) {
            Text(
                text = "%.1f".format(hashrate),
                fontSize = 32.sp,
                fontWeight = FontWeight.Bold,
                color = Color(0xFF7C3AED)
            )
            Text(
                text = "H/s",
                fontSize = 14.sp,
                color = Color.Gray
            )
        }
    }
}

@Composable
fun StatsRow(accepted: Long, rejected: Long, uptime: Long) {
    Row(
        modifier = Modifier.fillMaxWidth(0.9f),
        horizontalArrangement = Arrangement.SpaceEvenly
    ) {
        StatItem(value = "$accepted", label = "Accepted", color = Color(0xFF10B981))
        StatItem(value = "$rejected", label = "Rejected", color = Color(0xFFEF4444))
        StatItem(value = formatUptime(uptime), label = "Uptime", color = Color.White)
    }
}

@Composable
fun StatItem(value: String, label: String, color: Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = value,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            color = color
        )
        Text(
            text = label,
            fontSize = 9.sp,
            color = Color.Gray
        )
    }
}

private fun formatUptime(seconds: Long): String {
    val hours = seconds / 3600
    val minutes = (seconds % 3600) / 60
    return if (hours > 0) "${hours}h${minutes}m" else "${minutes}m"
}
