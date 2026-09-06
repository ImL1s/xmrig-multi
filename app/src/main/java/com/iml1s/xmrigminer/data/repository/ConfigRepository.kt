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
        val TLS_FINGERPRINT = stringPreferencesKey("tls_fingerprint")
        val AUTO_RECONNECT = booleanPreferencesKey("auto_reconnect")
        val COIN_TYPE = stringPreferencesKey("coin_type")
        val DONATE_LEVEL = intPreferencesKey("donate_level")
        val CUSTOM_ARGS = stringPreferencesKey("custom_args")
        val SOLO_DAEMON = booleanPreferencesKey("solo_daemon")
        val RANDOMX_MODE = stringPreferencesKey("randomx_mode")
        val RANDOMX_MODE_LOCKED = booleanPreferencesKey("randomx_mode_locked")
        val REQUIRE_EXTERNAL_POWER = booleanPreferencesKey("require_external_power")
        val PAUSE_ON_UNPLUG = booleanPreferencesKey("pause_on_unplug")
        val CHARGE_TO_PERCENT = intPreferencesKey("charge_to_percent_before_mine")
        val CHARGE_TO_PERCENT_ENABLED = booleanPreferencesKey("charge_to_percent_enabled")
        val MIN_BATTERY_PERCENT = intPreferencesKey("min_battery_percent")
        val RESUME_BATTERY_PERCENT = intPreferencesKey("resume_battery_percent")
        val PAUSE_ON_NET_DISCHARGE = booleanPreferencesKey("pause_on_net_discharge")
        val DREAM_MAY_MINE = booleanPreferencesKey("dream_may_mine")
        val MANUAL_WATTS = stringPreferencesKey("manual_watts")
        val ELECTRICITY_RATE_PER_KWH = stringPreferencesKey("electricity_rate_per_kwh")
        val ELECTRICITY_CURRENCY = stringPreferencesKey("electricity_currency")
        val DAILY_SPEND_CAP_FIAT = stringPreferencesKey("daily_spend_cap_fiat")
        val DAILY_KWH_CAP = stringPreferencesKey("daily_kwh_cap")
        val MONTHLY_SPEND_CAP_FIAT = stringPreferencesKey("monthly_spend_cap_fiat")
    }

    fun getConfig(): Flow<MiningConfig> = context.dataStore.data.map { prefs ->
        val defaultThreads = MiningConfig.defaultThreads()
        val chargeEnabled = prefs[Keys.CHARGE_TO_PERCENT_ENABLED] ?: false
        MiningConfig(
            poolUrl = prefs[Keys.POOL_URL] ?: ConfigRepositoryDefaults.POOL_URL,
            walletAddress = prefs[Keys.WALLET_ADDRESS] ?: "",
            workerName = prefs[Keys.WORKER_NAME] ?: "android",
            threads = (prefs[Keys.THREADS] ?: defaultThreads).coerceAtLeast(1),
            maxCpuUsage = prefs[Keys.MAX_CPU_USAGE] ?: 75,
            threadsAuto = prefs[Keys.THREADS_AUTO] ?: false,
            useTls = prefs[Keys.USE_TLS] ?: ConfigRepositoryDefaults.USE_TLS,
            tlsFingerprint = prefs[Keys.TLS_FINGERPRINT] ?: "",
            autoReconnect = prefs[Keys.AUTO_RECONNECT] ?: true,
            donateLevel = prefs[Keys.DONATE_LEVEL] ?: 1,
            customArgs = prefs[Keys.CUSTOM_ARGS] ?: "",
            coinType = prefs[Keys.COIN_TYPE] ?: "MONERO",
            soloDaemon = prefs[Keys.SOLO_DAEMON] ?: false,
            randomxMode = MiningConfig.normalizeRandomxMode(prefs[Keys.RANDOMX_MODE] ?: "auto"),
            randomxModeLocked = prefs[Keys.RANDOMX_MODE_LOCKED] ?: false,
            requireExternalPower = prefs[Keys.REQUIRE_EXTERNAL_POWER] ?: false,
            pauseOnUnplug = prefs[Keys.PAUSE_ON_UNPLUG] ?: false,
            chargeToPercentBeforeMine = if (chargeEnabled) {
                prefs[Keys.CHARGE_TO_PERCENT] ?: 50
            } else {
                null
            },
            minBatteryPercent = prefs[Keys.MIN_BATTERY_PERCENT] ?: 20,
            resumeBatteryPercent = prefs[Keys.RESUME_BATTERY_PERCENT] ?: 30,
            pauseOnNetDischargeWhilePlugged = prefs[Keys.PAUSE_ON_NET_DISCHARGE] ?: false,
            dreamMayMine = prefs[Keys.DREAM_MAY_MINE] ?: false,
            manualWatts = prefs[Keys.MANUAL_WATTS]?.toDoubleOrNull(),
            electricityRatePerKwh = prefs[Keys.ELECTRICITY_RATE_PER_KWH]?.toDoubleOrNull(),
            electricityCurrency = prefs[Keys.ELECTRICITY_CURRENCY] ?: "TWD",
            dailySpendCapFiat = prefs[Keys.DAILY_SPEND_CAP_FIAT]?.toDoubleOrNull(),
            dailyKwhCap = prefs[Keys.DAILY_KWH_CAP]?.toDoubleOrNull(),
            monthlySpendCapFiat = prefs[Keys.MONTHLY_SPEND_CAP_FIAT]?.toDoubleOrNull()
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
            prefs[Keys.TLS_FINGERPRINT] = config.tlsFingerprint
            prefs[Keys.AUTO_RECONNECT] = config.autoReconnect
            prefs[Keys.COIN_TYPE] = config.coinType
            prefs[Keys.DONATE_LEVEL] = config.donateLevel
            prefs[Keys.CUSTOM_ARGS] = config.customArgs
            prefs[Keys.SOLO_DAEMON] = config.soloDaemon
            prefs[Keys.RANDOMX_MODE] = MiningConfig.normalizeRandomxMode(config.randomxMode)
            prefs[Keys.RANDOMX_MODE_LOCKED] = config.randomxModeLocked
            prefs[Keys.REQUIRE_EXTERNAL_POWER] = config.requireExternalPower
            prefs[Keys.PAUSE_ON_UNPLUG] = config.pauseOnUnplug
            prefs[Keys.CHARGE_TO_PERCENT_ENABLED] = config.chargeToPercentBeforeMine != null
            prefs[Keys.CHARGE_TO_PERCENT] = config.chargeToPercentBeforeMine ?: 50
            prefs[Keys.MIN_BATTERY_PERCENT] = config.minBatteryPercent
            prefs[Keys.RESUME_BATTERY_PERCENT] = config.resumeBatteryPercent
            prefs[Keys.PAUSE_ON_NET_DISCHARGE] = config.pauseOnNetDischargeWhilePlugged
            prefs[Keys.DREAM_MAY_MINE] = config.dreamMayMine
            if (config.manualWatts != null) {
                prefs[Keys.MANUAL_WATTS] = config.manualWatts.toString()
            } else {
                prefs.remove(Keys.MANUAL_WATTS)
            }
            if (config.electricityRatePerKwh != null) {
                prefs[Keys.ELECTRICITY_RATE_PER_KWH] = config.electricityRatePerKwh.toString()
            } else {
                prefs.remove(Keys.ELECTRICITY_RATE_PER_KWH)
            }
            prefs[Keys.ELECTRICITY_CURRENCY] = config.electricityCurrency
            if (config.dailySpendCapFiat != null) {
                prefs[Keys.DAILY_SPEND_CAP_FIAT] = config.dailySpendCapFiat.toString()
            } else {
                prefs.remove(Keys.DAILY_SPEND_CAP_FIAT)
            }
            if (config.dailyKwhCap != null) {
                prefs[Keys.DAILY_KWH_CAP] = config.dailyKwhCap.toString()
            } else {
                prefs.remove(Keys.DAILY_KWH_CAP)
            }
            if (config.monthlySpendCapFiat != null) {
                prefs[Keys.MONTHLY_SPEND_CAP_FIAT] = config.monthlySpendCapFiat.toString()
            } else {
                prefs.remove(Keys.MONTHLY_SPEND_CAP_FIAT)
            }
        }
    }

    suspend fun clear() {
        context.dataStore.edit { it.clear() }
    }
}
