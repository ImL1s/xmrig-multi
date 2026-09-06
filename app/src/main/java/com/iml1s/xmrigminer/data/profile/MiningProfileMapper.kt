package com.iml1s.xmrigminer.data.profile

import com.iml1s.xmrigminer.data.model.CoinType
import com.iml1s.xmrigminer.data.model.MiningConfig

/**
 * Bidirectional adapter between legacy [MiningConfig] and versioned [MiningProfile] (#30).
 */
object MiningProfileMapper {

    fun fromMiningConfig(config: MiningConfig, id: String = "default"): MiningProfile {
        val coin = when (config.getCoin()) {
            CoinType.WOWNERO -> "wownero"
            CoinType.DERO -> "dero"
            CoinType.MONERO -> "monero"
        }
        val asset = when (config.getCoin()) {
            CoinType.WOWNERO -> "WOW"
            CoinType.DERO -> "DERO"
            CoinType.MONERO -> "XMR"
        }
        val mode = if (config.threadsAuto) "auto" else "manual"
        return MiningProfile(
            schemaVersion = MiningProfile.SCHEMA_VERSION,
            id = id,
            name = id,
            engine = "xmrig",
            coin = coin,
            payoutAsset = asset,
            endpoint = MiningProfile.Endpoint(
                type = if (config.soloDaemon) "daemon" else "stratum",
                url = config.poolUrl,
                tls = config.useTls,
                poolId = null
            ),
            account = MiningProfile.Account(
                user = config.walletAddress,
                pass = config.workerName,
                rigId = null
            ),
            cpu = MiningProfile.Cpu(
                mode = mode,
                threads = if (mode == "manual") config.threads else null,
                maxThreadsHintPercent = if (mode == "auto") config.maxCpuUsage else null,
                affinity = null
            ),
            randomx = MiningProfile.RandomX(
                mode = if (config.getCoin() == CoinType.WOWNERO) "light" else "auto"
            ),
            network = MiningProfile.Network(
                autoReconnect = config.autoReconnect,
                retries = config.retries,
                retryPauseSec = config.retryPause
            ),
            locks = MiningProfile.Locks(fields = emptyList()),
            donateLevel = config.donateLevel
        )
    }

    fun toMiningConfig(profile: MiningProfile): MiningConfig {
        require(profile.schemaVersion == MiningProfile.SCHEMA_VERSION) {
            "unsupported schemaVersion ${profile.schemaVersion}"
        }
        val coinType = when (profile.coin.lowercase()) {
            "wownero" -> CoinType.WOWNERO
            "dero" -> CoinType.DERO
            else -> CoinType.MONERO
        }
        val auto = profile.cpu.mode == "auto"
        return MiningConfig(
            poolUrl = profile.endpoint.url,
            walletAddress = profile.account.user,
            workerName = profile.account.pass.ifBlank { "android" },
            threads = profile.cpu.threads ?: MiningConfig.defaultThreads(),
            maxCpuUsage = profile.cpu.maxThreadsHintPercent ?: 75,
            threadsAuto = auto,
            useTls = profile.endpoint.tls == true,
            autoReconnect = profile.network.autoReconnect,
            donateLevel = profile.donateLevel,
            retries = profile.network.retries,
            retryPause = profile.network.retryPauseSec,
            coinType = coinType.name,
            soloDaemon = profile.endpoint.type == "daemon"
        )
    }
}
