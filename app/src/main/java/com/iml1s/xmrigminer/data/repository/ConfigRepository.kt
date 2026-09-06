package com.iml1s.xmrigminer.data.repository

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.iml1s.xmrigminer.data.model.MiningConfig
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

internal object ConfigRepositoryDefaults {
    const val POOL_URL = "gulf.moneroocean.stream:10128"
    const val USE_TLS = false
}

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "mining_config")

@Singleton
class ConfigRepository @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private object Keys {
        val POOL_URL = stringPreferencesKey("pool_url")
        val WALLET_ADDRESS = stringPreferencesKey("wallet_address")
        val WORKER_NAME = stringPreferencesKey("worker_name")
        val THREADS = intPreferencesKey("threads")
        val MAX_CPU_USAGE = intPreferencesKey("max_cpu_usage")
        val THREADS_AUTO = booleanPreferencesKey("threads_auto")
        val USE_TLS = booleanPreferencesKey("use_tls")
        val AUTO_RECONNECT = booleanPreferencesKey("auto_reconnect")
        val COIN_TYPE = stringPreferencesKey("coin_type")
        val DONATE_LEVEL = intPreferencesKey("donate_level")
        val CUSTOM_ARGS = stringPreferencesKey("custom_args")
        val SOLO_DAEMON = booleanPreferencesKey("solo_daemon")
        val RANDOMX_MODE = stringPreferencesKey("randomx_mode")
        val RANDOMX_MODE_LOCKED = booleanPreferencesKey("randomx_mode_locked")
    }

    fun getConfig(): Flow<MiningConfig> = context.dataStore.data.map { prefs ->
        val defaultThreads = MiningConfig.defaultThreads()
        MiningConfig(
            poolUrl = prefs[Keys.POOL_URL] ?: ConfigRepositoryDefaults.POOL_URL,
            walletAddress = prefs[Keys.WALLET_ADDRESS] ?: "",
            workerName = prefs[Keys.WORKER_NAME] ?: "android",
            threads = (prefs[Keys.THREADS] ?: defaultThreads).coerceAtLeast(1),
            maxCpuUsage = prefs[Keys.MAX_CPU_USAGE] ?: 75,
            threadsAuto = prefs[Keys.THREADS_AUTO] ?: false,
            useTls = prefs[Keys.USE_TLS] ?: ConfigRepositoryDefaults.USE_TLS,
            autoReconnect = prefs[Keys.AUTO_RECONNECT] ?: true,
            donateLevel = prefs[Keys.DONATE_LEVEL] ?: 1,
            customArgs = prefs[Keys.CUSTOM_ARGS] ?: "",
            coinType = prefs[Keys.COIN_TYPE] ?: "MONERO",
            soloDaemon = prefs[Keys.SOLO_DAEMON] ?: false,
            randomxMode = MiningConfig.normalizeRandomxMode(prefs[Keys.RANDOMX_MODE] ?: "auto"),
            randomxModeLocked = prefs[Keys.RANDOMX_MODE_LOCKED] ?: false
        )
    }

    suspend fun saveConfig(config: MiningConfig) {
        context.dataStore.edit { prefs ->
            prefs[Keys.POOL_URL] = config.poolUrl
            prefs[Keys.WALLET_ADDRESS] = config.walletAddress
            prefs[Keys.WORKER_NAME] = config.workerName
            prefs[Keys.THREADS] = config.threads
            prefs[Keys.MAX_CPU_USAGE] = config.maxCpuUsage
            prefs[Keys.THREADS_AUTO] = config.threadsAuto
            prefs[Keys.USE_TLS] = config.useTls
            prefs[Keys.AUTO_RECONNECT] = config.autoReconnect
            prefs[Keys.COIN_TYPE] = config.coinType
            prefs[Keys.DONATE_LEVEL] = config.donateLevel
            prefs[Keys.CUSTOM_ARGS] = config.customArgs
            prefs[Keys.SOLO_DAEMON] = config.soloDaemon
            prefs[Keys.RANDOMX_MODE] = MiningConfig.normalizeRandomxMode(config.randomxMode)
            prefs[Keys.RANDOMX_MODE_LOCKED] = config.randomxModeLocked
        }
    }

    suspend fun clear() {
        context.dataStore.edit { it.clear() }
    }
}
