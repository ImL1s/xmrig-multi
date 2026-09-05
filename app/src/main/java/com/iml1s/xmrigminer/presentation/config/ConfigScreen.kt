package com.iml1s.xmrigminer.presentation.config

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.iml1s.xmrigminer.data.model.CoinType
import com.iml1s.xmrigminer.data.model.MiningConfig
import com.iml1s.xmrigminer.data.model.Pool
import com.iml1s.xmrigminer.native.XmrigNativeCapabilities

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConfigScreen(
    viewModel: ConfigViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(Unit) {
        viewModel.uiEffect.collect { effect ->
            when (effect) {
                is ConfigUiEffect.ConfigSaved -> {
                    snackbarHostState.showSnackbar("Configuration saved successfully")
                    onNavigateBack()
                }
                is ConfigUiEffect.ShowError -> {
                    snackbarHostState.showSnackbar(effect.message)
                }
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Mining Configuration") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, "Back")
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.onEvent(ConfigUiEvent.ResetToDefaults) }) {
                        Icon(Icons.Default.Refresh, "Reset to defaults")
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { paddingValues ->
        when (val state = uiState) {
            is ConfigUiState.Loading -> {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            }
            
            is ConfigUiState.Error -> {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = state.message,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.error
                    )
                }
            }
            
            is ConfigUiState.Success -> {
                ConfigContent(
                    modifier = Modifier.padding(paddingValues),
                    state = state,
                    onEvent = viewModel::onEvent
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ConfigContent(
    modifier: Modifier = Modifier,
    state: ConfigUiState.Success,
    onEvent: (ConfigUiEvent) -> Unit
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Coin Type Selection (新增)
        CoinSelectionCard(
            selectedCoinType = state.selectedCoinType,
            onCoinTypeChanged = { onEvent(ConfigUiEvent.CoinTypeChanged(it)) }
        )

        // Pool / Solo Selection
        PoolSelectionCard(
            pools = state.filteredPools,
            selectedPool = state.selectedPool,
            currentPoolUrl = state.config.poolUrl,
            useTls = state.config.useTls,
            soloDaemon = state.config.soloDaemon,
            coinType = state.selectedCoinType,
            onPoolSelected = { onEvent(ConfigUiEvent.PoolSelected(it)) },
            onCustomUrlChanged = { onEvent(ConfigUiEvent.CustomPoolUrlChanged(it)) },
            onTlsToggled = { onEvent(ConfigUiEvent.TlsToggled(it)) },
            onSoloDaemonToggled = { onEvent(ConfigUiEvent.SoloDaemonToggled(it)) }
        )

        // Wallet Configuration
        WalletConfigCard(
            walletAddress = state.config.walletAddress,
            workerName = state.config.workerName,
            validationError = state.validationError,
            coinType = state.selectedCoinType,
            showWorkerName = !state.config.soloDaemon,
            onWalletAddressChanged = { onEvent(ConfigUiEvent.WalletAddressChanged(it)) },
            onWorkerNameChanged = { onEvent(ConfigUiEvent.WorkerNameChanged(it)) }
        )

        // Mining Settings
        MiningSettingsCard(
            threads = state.config.threads,
            maxCpuUsage = state.config.maxCpuUsage,
            onThreadsChanged = { onEvent(ConfigUiEvent.ThreadsChanged(it)) },
            onMaxCpuUsageChanged = { onEvent(ConfigUiEvent.MaxCpuUsageChanged(it)) }
        )

        // Save Button
        Button(
            onClick = { onEvent(ConfigUiEvent.SaveConfig) },
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            enabled = !state.isValidating && state.config.isValid() && state.validationError == null
        ) {
            if (state.isValidating) {
                CircularProgressIndicator(
                    modifier = Modifier.size(24.dp),
                    color = MaterialTheme.colorScheme.onPrimary
                )
            } else {
                Icon(Icons.Default.Check, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Save Configuration")
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
    }
}

@Composable
private fun CoinSelectionCard(
    selectedCoinType: CoinType,
    onCoinTypeChanged: (CoinType) -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                text = "Select Cryptocurrency",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                CoinType.entries.forEach { coinType ->
                    FilterChip(
                        selected = selectedCoinType == coinType,
                        onClick = { onCoinTypeChanged(coinType) },
                        label = { Text(coinType.displayName) },
                        modifier = Modifier.weight(1f),
                        leadingIcon = if (selectedCoinType == coinType) {
                            { Icon(Icons.Default.Check, contentDescription = null, Modifier.size(18.dp)) }
                        } else null
                    )
                }
            }

            // 演算法資訊
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.secondaryContainer,
                shape = MaterialTheme.shapes.small
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.Memory,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSecondaryContainer
                    )
                    Column {
                        Text(
                            text = "Algorithm: ${selectedCoinType.algorithm}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSecondaryContainer
                        )
                        Text(
                            text = when (selectedCoinType) {
                                CoinType.MONERO -> "RandomX - Full mode (2MB)"
                                CoinType.WOWNERO -> "RandomWOW - Light mode (1MB)"
                                CoinType.DERO -> "AstroBWT/v3 - CPU optimized"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSecondaryContainer
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PoolSelectionCard(
    pools: List<Pool>,
    selectedPool: Pool?,
    currentPoolUrl: String,
    useTls: Boolean,
    soloDaemon: Boolean,
    coinType: CoinType,
    onPoolSelected: (Pool) -> Unit,
    onCustomUrlChanged: (String) -> Unit,
    onTlsToggled: (Boolean) -> Unit,
    onSoloDaemonToggled: (Boolean) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    var showCustomUrl by remember { mutableStateOf(selectedPool == null || soloDaemon) }

    Card(
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                text = if (soloDaemon) "Solo / Daemon" else "Mining Pool",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary
            )

            if (coinType == CoinType.MONERO) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Solo mining (monerod)")
                        Text(
                            text = "Use your PC/LAN IP for monerod. Prefer binding that LAN IP (or firewall-allowlist the phone); do not expose unrestricted RPC on a public IP.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Switch(
                        checked = soloDaemon,
                        onCheckedChange = onSoloDaemonToggled
                    )
                }
            }

            if (soloDaemon) {
                OutlinedTextField(
                    value = currentPoolUrl,
                    onValueChange = onCustomUrlChanged,
                    label = { Text("Node RPC URL") },
                    placeholder = { Text(MiningConfig.DEFAULT_SOLO_DAEMON_URL) },
                    leadingIcon = { Icon(Icons.Default.Link, null) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    supportingText = {
                        Text("Use the PC/LAN IP running monerod, not 127.0.0.1 on the phone unless the node is on-device.")
                    }
                )
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.secondaryContainer,
                    shape = MaterialTheme.shapes.small
                ) {
                    Text(
                        text = "Phone hashrate is lottery-only vs network difficulty. TLS to the daemon is unavailable in this Android build.",
                        modifier = Modifier.padding(12.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSecondaryContainer
                    )
                }
            } else {
                // Pool Dropdown
                ExposedDropdownMenuBox(
                    expanded = expanded,
                    onExpandedChange = { expanded = it }
                ) {
                    OutlinedTextField(
                        value = selectedPool?.name ?: "Custom Pool",
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Select Pool") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .menuAnchor()
                    )

                    ExposedDropdownMenu(
                        expanded = expanded,
                        onDismissRequest = { expanded = false }
                    ) {
                        pools.forEach { pool ->
                            DropdownMenuItem(
                                text = {
                                    Column {
                                        Text(pool.name)
                                        Text(
                                            text = "${pool.description} • Fee: ${pool.fee}",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                },
                                onClick = {
                                    onPoolSelected(pool)
                                    showCustomUrl = false
                                    expanded = false
                                }
                            )
                        }

                        Divider()

                        DropdownMenuItem(
                            text = { Text("Custom Pool URL") },
                            onClick = {
                                showCustomUrl = true
                                expanded = false
                            }
                        )
                    }
                }

                if (showCustomUrl) {
                    OutlinedTextField(
                        value = currentPoolUrl,
                        onValueChange = onCustomUrlChanged,
                        label = { Text("Custom Pool URL") },
                        placeholder = { Text("pool.example.com:3333") },
                        leadingIcon = { Icon(Icons.Default.Link, null) },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Use TLS/SSL")
                        Text(
                            text = if (XmrigNativeCapabilities.TLS_ENABLED) {
                                "Encrypted connection to mining pool"
                            } else {
                                "Unavailable: packaged XMRig is built without TLS"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Switch(
                        checked = useTls,
                        enabled = XmrigNativeCapabilities.TLS_ENABLED || useTls,
                        onCheckedChange = onTlsToggled
                    )
                }

                selectedPool?.let { pool ->
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        color = MaterialTheme.colorScheme.secondaryContainer,
                        shape = MaterialTheme.shapes.small
                    ) {
                        Column(
                            modifier = Modifier.padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Text(
                                text = "Pool Information",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSecondaryContainer
                            )
                            Text(
                                text = pool.getUrl(useTls),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSecondaryContainer
                            )
                            Text(
                                text = "Fee: ${pool.fee}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSecondaryContainer
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun WalletConfigCard(
    walletAddress: String,
    workerName: String,
    validationError: String?,
    coinType: CoinType,
    showWorkerName: Boolean,
    onWalletAddressChanged: (String) -> Unit,
    onWorkerNameChanged: (String) -> Unit
) {
    val walletLabel = when (coinType) {
        CoinType.MONERO -> "Monero Wallet Address *"
        CoinType.WOWNERO -> "Wownero Wallet Address *"
        CoinType.DERO -> "DERO Wallet Address *"
    }
    val walletPlaceholder = when (coinType) {
        CoinType.MONERO -> "4..."
        CoinType.WOWNERO -> "Wo..."
        CoinType.DERO -> "dero..."
    }

    Card(
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                text = "Wallet Configuration",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary
            )

            OutlinedTextField(
                value = walletAddress,
                onValueChange = onWalletAddressChanged,
                label = { Text(walletLabel) },
                placeholder = { Text(walletPlaceholder) },
                leadingIcon = { Icon(Icons.Default.AccountBalanceWallet, null) },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                isError = validationError != null,
                supportingText = {
                    if (validationError != null) {
                        Text(
                            text = validationError,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                }
            )

            if (showWorkerName) {
                OutlinedTextField(
                    value = workerName,
                    onValueChange = onWorkerNameChanged,
                    label = { Text("Worker Name") },
                    placeholder = { Text("android") },
                    leadingIcon = { Icon(Icons.Default.Devices, null) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )
            }
        }
    }
}

@Composable
private fun MiningSettingsCard(
    threads: Int,
    maxCpuUsage: Int,
    onThreadsChanged: (Int) -> Unit,
    onMaxCpuUsageChanged: (Int) -> Unit
) {
    val maxThreads = Runtime.getRuntime().availableProcessors()

    Card(
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = "Mining Settings",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary
            )

            // Threads
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("CPU Threads")
                    Text(
                        text = "$threads / $maxThreads",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                Slider(
                    value = threads.toFloat(),
                    onValueChange = { onThreadsChanged(it.toInt()) },
                    valueRange = 1f..maxThreads.toFloat(),
                    steps = maxThreads - 2
                )
                Text(
                    text = "Number of CPU threads to use for mining",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Divider()

            // Max CPU Usage
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("Max CPU Usage")
                    Text(
                        text = "$maxCpuUsage%",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                Slider(
                    value = maxCpuUsage.toFloat(),
                    onValueChange = { onMaxCpuUsageChanged(it.toInt()) },
                    valueRange = 10f..100f,
                    steps = 8
                )
                Text(
                    text = "Maximum CPU usage target",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = MaterialTheme.colorScheme.tertiaryContainer,
                shape = MaterialTheme.shapes.small
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.Info,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onTertiaryContainer
                    )
                    Text(
                        text = "Higher CPU usage = better hashrate but more battery drain",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onTertiaryContainer
                    )
                }
            }
        }
    }
}
