package com.iml1s.xmrigminer.presentation.mining

import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.BatteryChargingFull
import androidx.compose.material.icons.filled.BatteryStd
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.GridOn
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Thermostat
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.iml1s.xmrigminer.data.model.CoinType
import com.iml1s.xmrigminer.data.model.MiningStats
import com.iml1s.xmrigminer.native.XmrigNativeCapabilities
import com.iml1s.xmrigminer.presentation.format.MetricFormat
import com.iml1s.xmrigminer.presentation.format.MetricQuality
import com.iml1s.xmrigminer.presentation.format.MetricReading
import com.iml1s.xmrigminer.presentation.theme.LocalMinerColors
import com.iml1s.xmrigminer.presentation.theme.ReadoutMono
import com.iml1s.xmrigminer.presentation.theme.ReadoutValue
import com.iml1s.xmrigminer.presentation.theme.Sizes
import com.iml1s.xmrigminer.presentation.theme.Space

/**
 * Mining console.
 *
 * Reading order is deliberate: what state is the miner in, what is it producing, what can I do
 * about it, and only then the supporting telemetry. Every number routes through [MetricFormat]
 * so an unknown reads as unknown instead of a zero (#54).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MiningScreen(
    viewModel: MiningViewModel = hiltViewModel(),
    onNavigateToConfig: () -> Unit = {},
    onNavigateToStats: () -> Unit = {},
    onNavigateToAmbient: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current

    LaunchedEffect(Unit) {
        viewModel.effects.collect { effect ->
            when (effect) {
                is MiningEffect.ShowToast ->
                    Toast.makeText(context, effect.message, Toast.LENGTH_SHORT).show()

                is MiningEffect.NavigateToConfig -> {
                    Toast.makeText(context, effect.reason, Toast.LENGTH_LONG).show()
                    onNavigateToConfig()
                }
            }
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "XMRig Multi",
                        style = MaterialTheme.typography.titleLarge
                    )
                },
                actions = {
                    IconButton(onClick = onNavigateToAmbient) {
                        Icon(Icons.Default.Schedule, contentDescription = "Ambient clock")
                    }
                    IconButton(onClick = onNavigateToStats) {
                        Icon(Icons.Default.BarChart, contentDescription = "挖礦統計")
                    }
                    IconButton(onClick = onNavigateToConfig) {
                        Icon(Icons.Default.Settings, contentDescription = "挖礦設定")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color.Transparent,
                    titleContentColor = MaterialTheme.colorScheme.onBackground,
                    actionIconContentColor = MaterialTheme.colorScheme.onSurfaceVariant
                )
            )
        }
    ) { padding ->
        BoxWithConstraints(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            val twoColumn = maxWidth >= Sizes.twoColumnBreakpoint

            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = Space.lg, vertical = Space.sm),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Column(
                    modifier = Modifier.widthIn(max = if (twoColumn) 1000.dp else Sizes.maxContentWidth),
                    verticalArrangement = Arrangement.spacedBy(Space.md)
                ) {
                    AnimatedVisibility(
                        visible = uiState.error != null,
                        enter = fadeIn() + expandVertically(),
                        exit = fadeOut() + shrinkVertically()
                    ) {
                        FaultBanner(
                            message = uiState.error.orEmpty(),
                            onDismiss = { viewModel.onEvent(MiningEvent.ClearError) }
                        )
                    }

                    if (twoColumn) {
                        Row(horizontalArrangement = Arrangement.spacedBy(Space.md)) {
                            Column(
                                modifier = Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(Space.md)
                            ) {
                                StatusPanel(uiState.isRunning, uiState.stats)
                                PrimaryAction(uiState, viewModel)
                                LimitsPanel()
                            }
                            Column(
                                modifier = Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(Space.md)
                            ) {
                                HashrateWindowsPanel(uiState.stats, uiState.isRunning)
                                DeviceStatePanel(uiState.stats, uiState.isRunning)
                                CpuPanel()
                            }
                        }
                    } else {
                        StatusPanel(uiState.isRunning, uiState.stats)
                        PrimaryAction(uiState, viewModel)
                        LimitsPanel()
                        HashrateWindowsPanel(uiState.stats, uiState.isRunning)
                        DeviceStatePanel(uiState.stats, uiState.isRunning)
                        CpuPanel()
                    }

                    Spacer(Modifier.height(Space.xl))
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

@Composable
private fun StatusPanel(isRunning: Boolean, stats: MiningStats) {
    val miner = LocalMinerColors.current
    val hashrate = MetricFormat.hashrate(stats.hashrate60s.takeIf { it > 0.0 } ?: stats.hashrate, isRunning)
    val uptime = MetricFormat.uptime(stats.uptime)
    val stateLabel = if (isRunning) "挖礦中" else "已停止"

    Panel(emphasised = isRunning) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                // Announce only the run state. The readouts change every second and would
                // otherwise flood a screen reader (#58).
                .semantics {
                    liveRegion = LiveRegionMode.Polite
                    contentDescription = "挖礦狀態：$stateLabel"
                },
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Space.sm),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(Sizes.statusDot)
                        .background(
                            color = if (isRunning) miner.signal else miner.inert,
                            shape = CircleShape
                        )
                )
                Text(
                    text = stateLabel,
                    style = MaterialTheme.typography.titleMedium,
                    color = if (isRunning) miner.signal else MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (isRunning) {
                CircularProgressIndicator(
                    modifier = Modifier.size(16.dp),
                    strokeWidth = 2.dp,
                    color = miner.signal
                )
            }
        }

        Spacer(Modifier.height(Space.lg))

        // Hero readout: value, then the window it covers and how much to trust it.
        Text(
            text = hashrate.text,
            style = MaterialTheme.typography.displayMedium,
            color = if (hashrate.hasValue) {
                MaterialTheme.colorScheme.onSurface
            } else {
                miner.inkFaint
            },
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Space.sm)
        ) {
            Text(
                text = if (stats.hashrate60s > 0.0) "60 秒平均算力" else "目前算力",
                style = MaterialTheme.typography.bodySmall,
                color = miner.inkFaint
            )
            // A stopped miner has no reading because nothing is running, which is not the same as
            // the device being unable to measure it. Say the former rather than the latter's word.
            if (isRunning) {
                QualityTag(hashrate.quality)
            } else {
                QualityTag(MetricQuality.UNAVAILABLE, label = "尚未啟動")
            }
        }

        Spacer(Modifier.height(Space.lg))
        Hairline()
        Spacer(Modifier.height(Space.md))

        // Before any session has run there is nothing to count, and "0 accepted / 0:00:00" reads as
        // a measurement rather than an absence. Once a session starts the real numbers show, zeros
        // included, because by then the zero is the news (#54).
        val hasSession = isRunning ||
            stats.uptime > 0L ||
            stats.acceptedShares > 0 ||
            stats.rejectedShares > 0

        Row(modifier = Modifier.fillMaxWidth()) {
            LedgerCell("已接受", stats.acceptedShares.toString(), Modifier.weight(1f), hasSession)
            LedgerCell("已拒絕", stats.rejectedShares.toString(), Modifier.weight(1f), hasSession)
            val successRate = MetricFormat.shareSuccessRate(stats.acceptedShares, stats.rejectedShares)
            LedgerCell(
                label = "成功率",
                value = successRate.text,
                modifier = Modifier.weight(1f),
                // Same rule as web: 0+0 shares is unavailable (–), not a measured 0.0%.
                hasValue = hasSession && successRate.hasValue
            )
            LedgerCell("運行時間", uptime.text, Modifier.weight(1.3f), hasSession)
        }
    }
}

@Composable
private fun LedgerCell(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    hasValue: Boolean = true
) {
    val miner = LocalMinerColors.current
    Column(
        modifier = modifier.semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(Space.xs)
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = miner.inkFaint,
            maxLines = 1
        )
        Text(
            text = if (hasValue) value else MetricReading.PLACEHOLDER,
            style = ReadoutValue.copy(textAlign = TextAlign.Start),
            color = if (hasValue) MaterialTheme.colorScheme.onSurface else miner.inkFaint,
            maxLines = 1
        )
    }
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

@Composable
private fun PrimaryAction(uiState: MiningUiState, viewModel: MiningViewModel) {
    val isRunning = uiState.isRunning
    val busy = uiState.isLoading

    Button(
        onClick = {
            viewModel.onEvent(if (isRunning) MiningEvent.StopMining else MiningEvent.StartMining)
        },
        enabled = !busy,
        modifier = Modifier
            .fillMaxWidth()
            .height(Sizes.primaryActionHeight),
        shape = MaterialTheme.shapes.small,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (isRunning) {
                MaterialTheme.colorScheme.errorContainer
            } else {
                MaterialTheme.colorScheme.primary
            },
            contentColor = if (isRunning) {
                MaterialTheme.colorScheme.onErrorContainer
            } else {
                MaterialTheme.colorScheme.onPrimary
            }
        )
    ) {
        if (busy) {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                strokeWidth = 2.dp,
                color = MaterialTheme.colorScheme.onPrimary
            )
            Spacer(Modifier.width(Space.sm))
            Text(if (isRunning) "正在停止…" else "正在啟動…", style = MaterialTheme.typography.labelLarge)
        } else {
            Icon(
                imageVector = if (isRunning) Icons.Default.Stop else Icons.Default.PlayArrow,
                contentDescription = null,
                modifier = Modifier.size(20.dp)
            )
            Spacer(Modifier.width(Space.sm))
            Text(
                text = if (isRunning) "停止挖礦" else "開始挖礦",
                style = MaterialTheme.typography.labelLarge
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

/**
 * Standing limitations of this build.
 *
 * Stating them on the home screen — rather than only where the switch lives — keeps the app
 * from implying that an unsupported coin or an unavailable transport is merely unselected.
 */
@Composable
private fun LimitsPanel() {
    val limits = remember {
        buildList {
            val blocked = CoinType.entries.filter {
                XmrigNativeCapabilities.capabilityFor(it).status !=
                    XmrigNativeCapabilities.CoinStatus.SUPPORTED
            }
            if (blocked.isNotEmpty()) {
                add("${blocked.joinToString("、") { it.displayName }} 在此版本無法挖礦，設定頁會擋下啟動")
            }
            if (!XmrigNativeCapabilities.TLS_ENABLED) {
                add("此版本的 XMRig TLS 未解鎖，僅能連線到非加密礦池埠 (#134)")
            }
            if (!XmrigNativeCapabilities.DAEMON_ENABLED) {
                add("Solo/daemon 需要 WITH_HTTP=ON 原生建置；目前能力未宣告 (#134)")
            }
        }
    }
    if (limits.isEmpty()) return

    val miner = LocalMinerColors.current
    Panel(accent = miner.caution) {
        SectionLabel("目前限制")
        Spacer(Modifier.height(Space.sm))
        limits.forEach { line ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = Space.xs),
                horizontalArrangement = Arrangement.spacedBy(Space.sm)
            ) {
                Icon(
                    imageVector = Icons.Default.Warning,
                    contentDescription = null,
                    tint = miner.caution,
                    modifier = Modifier.size(Sizes.rowIcon)
                )
                Text(
                    text = line,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface
                )
            }
        }
    }
}

@Composable
private fun HashrateWindowsPanel(stats: MiningStats, isRunning: Boolean) {
    Panel {
        SectionLabel("算力視窗")
        Spacer(Modifier.height(Space.md))
        Row(modifier = Modifier.fillMaxWidth()) {
            WindowCell("10 秒", MetricFormat.hashrate(stats.hashrate10s, isRunning), Modifier.weight(1f))
            WindowCell("60 秒", MetricFormat.hashrate(stats.hashrate60s, isRunning), Modifier.weight(1f))
            WindowCell("15 分", MetricFormat.hashrate(stats.hashrate15m, isRunning), Modifier.weight(1f))
        }
    }
}

@Composable
private fun WindowCell(label: String, reading: MetricReading, modifier: Modifier = Modifier) {
    val miner = LocalMinerColors.current
    Column(
        modifier = modifier.semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(Space.xs)
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = miner.inkFaint)
        Text(
            text = reading.text,
            style = ReadoutMono,
            color = if (reading.hasValue) MaterialTheme.colorScheme.onSurface else miner.inkFaint,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@Composable
private fun DeviceStatePanel(stats: MiningStats, isRunning: Boolean) {
    Panel {
        SectionLabel("裝置狀態")
        Spacer(Modifier.height(Space.sm))

        MetricRow(
            icon = Icons.Default.Memory,
            // Scope is in the label because the collector samples this app's process, not the
            // XMRig child. Calling it "CPU usage" would overstate it (#54).
            label = "App 程序 CPU",
            reading = MetricFormat.processCpuPercent(stats.cpuUsage, isRunning)
        )
        MetricRow(
            icon = Icons.Default.Thermostat,
            label = "裝置溫度",
            reading = MetricFormat.temperature(stats.temperature)
        )
        MetricRow(
            icon = if (stats.isCharging) Icons.Default.BatteryChargingFull else Icons.Default.BatteryStd,
            label = if (stats.isCharging) "電量（充電中）" else "電量",
            reading = MetricFormat.battery(stats.batteryLevel)
        )
        MetricRow(
            icon = Icons.Default.GridOn,
            label = "目前難度",
            reading = MetricFormat.difficulty(stats.difficulty)
        )
    }
}

@Composable
private fun CpuPanel() {
    val miner = LocalMinerColors.current
    val cpuInfo = remember {
        runCatching { com.iml1s.xmrigminer.native.XMRigBridge.getCpuInfo() }
            .getOrNull()
            ?.takeIf { it.isNotBlank() }
    }

    Panel {
        SectionLabel("處理器")
        Spacer(Modifier.height(Space.sm))
        Text(
            text = cpuInfo ?: "無法讀取處理器資訊",
            style = ReadoutMono,
            color = if (cpuInfo != null) {
                MaterialTheme.colorScheme.onSurfaceVariant
            } else {
                miner.inkFaint
            }
        )
    }
}

@Composable
private fun FaultBanner(message: String, onDismiss: () -> Unit) {
    val miner = LocalMinerColors.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(miner.haltContainer, MaterialTheme.shapes.small)
            .border(1.dp, miner.halt, MaterialTheme.shapes.small)
            .padding(start = Space.md, top = Space.sm, bottom = Space.sm)
            .semantics { liveRegion = LiveRegionMode.Assertive },
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = Icons.Default.Warning,
            contentDescription = null,
            tint = miner.haltInk,
            modifier = Modifier.size(Sizes.rowIcon)
        )
        Spacer(Modifier.width(Space.sm))
        Text(
            text = message,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodySmall,
            color = miner.haltInk
        )
        IconButton(onClick = onDismiss, modifier = Modifier.size(Sizes.minTouchTarget)) {
            Icon(
                imageVector = Icons.Default.Close,
                contentDescription = "關閉錯誤訊息",
                tint = miner.haltInk,
                modifier = Modifier.size(Sizes.rowIcon)
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/**
 * Flat surface with a hairline edge.
 *
 * Elevation shadows read as decoration on a console; a drawn edge reads as a panel boundary and
 * stays visible in both themes and in high-contrast modes.
 */
@Composable
private fun Panel(
    emphasised: Boolean = false,
    accent: Color? = null,
    content: @Composable ColumnScope.() -> Unit
) {
    val miner = LocalMinerColors.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                color = if (emphasised) {
                    MaterialTheme.colorScheme.surfaceVariant
                } else {
                    MaterialTheme.colorScheme.surface
                },
                shape = MaterialTheme.shapes.medium
            )
            .border(1.dp, accent ?: miner.hairline, MaterialTheme.shapes.medium)
            .padding(Space.lg),
        content = content
    )
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text = text.uppercase(),
        style = MaterialTheme.typography.titleSmall,
        color = LocalMinerColors.current.inkFaint
    )
}

@Composable
private fun Hairline() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(LocalMinerColors.current.hairline)
    )
}

@Composable
private fun MetricRow(icon: ImageVector, label: String, reading: MetricReading) {
    val miner = LocalMinerColors.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 40.dp)
            .semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(Space.sm),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(Sizes.rowIcon),
                tint = miner.inkFaint
            )
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(Space.sm),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = reading.text,
                style = ReadoutValue,
                color = if (reading.hasValue) {
                    MaterialTheme.colorScheme.onSurface
                } else {
                    miner.inkFaint
                }
            )
            QualityTag(reading.quality)
        }
    }
}

/**
 * Text badge stating how much the neighbouring number can be trusted.
 *
 * Text rather than a colour swatch, so the distinction survives greyscale and colour-vision
 * differences (#58). Measured values carry no badge — that is the unremarkable case.
 */
@Composable
private fun QualityTag(quality: MetricQuality, label: String? = null) {
    val miner = LocalMinerColors.current
    val (defaultLabel, fg, bg) = when (quality) {
        MetricQuality.MEASURED -> return
        MetricQuality.ESTIMATED -> Triple("估計", miner.caution, miner.cautionContainer)
        MetricQuality.PENDING -> Triple("取樣中", miner.signal, miner.signalContainer)
        MetricQuality.UNAVAILABLE -> Triple("無法量測", miner.inert, miner.inertContainer)
        MetricQuality.STALE -> Triple("已過期", miner.caution, miner.cautionContainer)
    }
    val text = label ?: defaultLabel
    Text(
        text = text,
        modifier = Modifier
            .background(bg, MaterialTheme.shapes.extraSmall)
            .padding(horizontal = 6.dp, vertical = 2.dp)
            .clearAndSetSemantics { contentDescription = "資料品質：$text" },
        style = MaterialTheme.typography.labelSmall,
        color = fg,
        fontWeight = FontWeight.Medium,
        maxLines = 1
    )
}
