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
        val USE_TLS = booleanPreferencesKey("use_tls")
        val AUTO_RECONNECT = booleanPreferencesKey("auto_reconnect")
        val COIN_TYPE = stringPreferencesKey("coin_type")
        val DONATE_LEVEL = intPreferencesKey("donate_level")
        val CUSTOM_ARGS = stringPreferencesKey("custom_args")
    }

    fun getConfig(): Flow<MiningConfig> = context.dataStore.data.map { prefs ->
        val defaultThreads = (Runtime.getRuntime().availableProcessors() - 1).coerceAtLeast(1)
        MiningConfig(
            poolUrl = prefs[Keys.POOL_URL] ?: "gulf.moneroocean.stream:10128",
            walletAddress = prefs[Keys.WALLET_ADDRESS] ?: "",
            workerName = prefs[Keys.WORKER_NAME] ?: "android",
            threads = prefs[Keys.THREADS] ?: defaultThreads,
            maxCpuUsage = prefs[Keys.MAX_CPU_USAGE] ?: 75,
            useTls = prefs[Keys.USE_TLS] ?: false,
            autoReconnect = prefs[Keys.AUTO_RECONNECT] ?: true,
            donateLevel = prefs[Keys.DONATE_LEVEL] ?: 1,
            customArgs = prefs[Keys.CUSTOM_ARGS] ?: "",
            coinType = prefs[Keys.COIN_TYPE] ?: "MONERO"
        )
    }

    suspend fun saveConfig(config: MiningConfig) {
        context.dataStore.edit { prefs ->
            prefs[Keys.POOL_URL] = config.poolUrl
            prefs[Keys.WALLET_ADDRESS] = config.walletAddress
            prefs[Keys.WORKER_NAME] = config.workerName
            prefs[Keys.THREADS] = config.threads
            prefs[Keys.MAX_CPU_USAGE] = config.maxCpuUsage
            prefs[Keys.USE_TLS] = config.useTls
            prefs[Keys.AUTO_RECONNECT] = config.autoReconnect
            prefs[Keys.COIN_TYPE] = config.coinType
            prefs[Keys.DONATE_LEVEL] = config.donateLevel
            prefs[Keys.CUSTOM_ARGS] = config.customArgs
        }
    }

    suspend fun clear() {
        context.dataStore.edit { it.clear() }
    }
}
