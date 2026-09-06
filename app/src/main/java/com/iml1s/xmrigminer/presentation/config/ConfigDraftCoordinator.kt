package com.iml1s.xmrigminer.presentation.config

import com.iml1s.xmrigminer.data.daemon.DaemonEndpoint
import com.iml1s.xmrigminer.data.model.CoinType
import com.iml1s.xmrigminer.data.model.MiningConfig
import com.iml1s.xmrigminer.data.model.Pool

/**
 * Per-coin / per-mode draft stash for Android config editing (#52).
 *
 * Switching coin or pool↔solo must not wipe the user's other drafts. The active
 * [MiningConfig] always reflects the coin currently on screen; inactive coins keep
 * their last wallet/endpoint/worker until restored.
 */
data class CoinModeDraft(
    val walletAddress: String = "",
    val poolUrl: String = "",
    val workerName: String = "android",
    val useTls: Boolean = false,
    val soloDaemon: Boolean = false,
    val selectedPoolId: String? = null
) {
    companion object {
        fun fromConfig(config: MiningConfig, selectedPool: Pool?): CoinModeDraft =
            CoinModeDraft(
                walletAddress = config.walletAddress,
                poolUrl = config.poolUrl,
                workerName = config.workerName,
                useTls = config.useTls,
                soloDaemon = config.soloDaemon,
                selectedPoolId = selectedPool?.id ?: selectedPool?.name
            )
    }
}

class ConfigDraftCoordinator(
    private val availablePools: () -> List<Pool>
) {
    private val drafts = mutableMapOf<DraftKey, CoinModeDraft>()

    data class DraftKey(val coin: CoinType, val solo: Boolean)

    fun stash(coin: CoinType, solo: Boolean, draft: CoinModeDraft) {
        drafts[DraftKey(coin, solo)] = draft
    }

    fun stashFrom(config: MiningConfig, selectedPool: Pool?) {
        stash(config.getCoin(), config.soloDaemon, CoinModeDraft.fromConfig(config, selectedPool))
    }

    fun restore(coin: CoinType, solo: Boolean): CoinModeDraft? = drafts[DraftKey(coin, solo)]

    /**
     * Build the config shown after a coin switch without wiping other coins' drafts.
     */
    fun switchCoin(
        current: MiningConfig,
        selectedPool: Pool?,
        targetCoin: CoinType
    ): Pair<MiningConfig, Pool?> {
        stashFrom(current, selectedPool)

        val wantSolo = current.soloDaemon && targetCoin == CoinType.MONERO
        val restored = restore(targetCoin, wantSolo)
        val pools = availablePools().filter { it.getCoinType() == targetCoin }

        if (restored != null) {
            val pool = resolvePool(restored, pools)
            val poolUrl = when {
                restored.soloDaemon -> restored.poolUrl.ifBlank { MiningConfig.DEFAULT_SOLO_DAEMON_URL }
                pool != null -> pool.getUrl(restored.useTls)
                restored.poolUrl.isNotBlank() -> restored.poolUrl
                else -> defaultPoolUrl(targetCoin, pools, restored.useTls)
            }
            return current.copy(
                coinType = targetCoin.name,
                walletAddress = restored.walletAddress,
                workerName = restored.workerName,
                poolUrl = poolUrl,
                useTls = if (wantSolo) false else restored.useTls,
                soloDaemon = wantSolo
            ) to if (wantSolo) null else pool
        }

        val defaultPool = pools.firstOrNull { it.isStartAllowed() } ?: pools.firstOrNull()
        val poolUrl = when {
            wantSolo -> MiningConfig.DEFAULT_SOLO_DAEMON_URL
            else -> defaultPool?.getUrl(current.useTls)
                ?: if (targetCoin == CoinType.MONERO) MiningConfig.getDefaultPoolUrl(targetCoin) else ""
        }
        return current.copy(
            coinType = targetCoin.name,
            walletAddress = "",
            poolUrl = poolUrl,
            soloDaemon = wantSolo,
            useTls = if (wantSolo) false else current.useTls
        ) to if (wantSolo) null else defaultPool?.takeIf { it.isStartAllowed() }
    }

    /**
     * Leaving solo restores the last pool-mode draft for Monero, not an arbitrary first pool.
     */
    fun toggleSolo(
        current: MiningConfig,
        selectedPool: Pool?,
        enabled: Boolean
    ): Pair<MiningConfig, Pool?> {
        require(current.getCoin() == CoinType.MONERO || !enabled) {
            "Solo is Monero-only"
        }
        stashFrom(current, selectedPool)

        if (enabled) {
            val restored = restore(CoinType.MONERO, solo = true)
            val daemonUrl = pickSoloUrl(restored?.poolUrl, current.poolUrl)
            return current.copy(
                soloDaemon = true,
                useTls = false,
                coinType = CoinType.MONERO.name,
                poolUrl = daemonUrl,
                walletAddress = restored?.walletAddress ?: current.walletAddress,
                workerName = restored?.workerName ?: current.workerName
            ) to null
        }

        val restored = restore(CoinType.MONERO, solo = false)
        val pools = availablePools().filter { it.getCoinType() == CoinType.MONERO }
        if (restored != null) {
            val pool = resolvePool(restored, pools)
            val poolUrl = when {
                pool != null -> pool.getUrl(restored.useTls)
                restored.poolUrl.isNotBlank() -> restored.poolUrl
                else -> defaultPoolUrl(CoinType.MONERO, pools, restored.useTls)
            }
            return current.copy(
                soloDaemon = false,
                useTls = restored.useTls,
                poolUrl = poolUrl,
                walletAddress = restored.walletAddress.ifBlank { current.walletAddress },
                workerName = restored.workerName
            ) to pool
        }

        val fallback = pools.firstOrNull { it.isStartAllowed() } ?: pools.firstOrNull()
        return current.copy(
            soloDaemon = false,
            poolUrl = fallback?.getUrl(false) ?: MiningConfig.getDefaultPoolUrl(CoinType.MONERO)
        ) to fallback
    }

    fun clear() {
        drafts.clear()
    }

    private fun resolvePool(draft: CoinModeDraft, pools: List<Pool>): Pool? {
        draft.selectedPoolId?.let { id ->
            pools.find { it.id == id || it.name == id }?.let { return it }
        }
        return pools.find { it.url == draft.poolUrl || it.sslUrl == draft.poolUrl }
    }

    private fun defaultPoolUrl(coin: CoinType, pools: List<Pool>, useTls: Boolean): String {
        val pool = pools.firstOrNull { it.isStartAllowed() } ?: pools.firstOrNull()
        return pool?.getUrl(useTls)
            ?: if (coin == CoinType.MONERO) MiningConfig.getDefaultPoolUrl(coin) else ""
    }

    /**
     * Prefer a previously saved daemon URL that parses as a real endpoint (#44).
     * Do not use fragile `contains("18081")` heuristics — but also do not treat
     * a Stratum pool host:port (e.g. :3333) as a solo daemon when entering solo.
     */
    private fun pickSoloUrl(restored: String?, current: String): String {
        fun asSoloCandidate(raw: String?): String? {
            if (raw.isNullOrBlank()) return null
            val parsed = DaemonEndpoint.parse(raw)
            if (!parsed.ok || parsed.engineUrl == null) return null
            val port = parsed.port ?: return null
            val daemonish = parsed.isLoopback
                || parsed.scheme == "http"
                || parsed.scheme == "https"
                || port in DAEMON_PORTS
            return if (daemonish) parsed.engineUrl else null
        }
        // Restored solo draft is trusted if it parses at all.
        val fromRestored = restored?.let { raw ->
            val p = DaemonEndpoint.parse(raw)
            if (p.ok) p.engineUrl else null
        }
        return fromRestored
            ?: asSoloCandidate(current)
            ?: MiningConfig.DEFAULT_SOLO_DAEMON_URL
    }

    companion object {
        private val DAEMON_PORTS = setOf(18081, 18082, 18089, 38081, 38089)
    }
}
