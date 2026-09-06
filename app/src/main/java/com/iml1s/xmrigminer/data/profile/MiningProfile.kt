package com.iml1s.xmrigminer.data.profile

/**
 * Cross-platform MiningProfile v1 contract (#30).
 * Mirrors shared/mining-profile/schema/mining-profile.schema.json.
 */
data class MiningProfile(
    val schemaVersion: Int = SCHEMA_VERSION,
    val id: String = "default",
    val name: String = "Default",
    val engine: String = "xmrig",
    val coin: String = "monero",
    val payoutAsset: String = "XMR",
    val endpoint: Endpoint = Endpoint(),
    val account: Account = Account(),
    val cpu: Cpu = Cpu(),
    val randomx: RandomX = RandomX(),
    val network: Network = Network(),
    val locks: Locks = Locks(),
    val donateLevel: Int = 1
) {
    data class Endpoint(
        val type: String = "stratum",
        val url: String = "",
        val tls: Boolean? = null,
        val poolId: String? = null
    )

    data class Account(
        val user: String = "",
        val pass: String = "x",
        val rigId: String? = null
    )

    /**
     * [mode] is either "auto" or "manual".
     * Manual uses [threads]; auto uses [maxThreadsHintPercent]. Never overload one Int.
     */
    data class Cpu(
        val mode: String = "manual",
        val threads: Int? = null,
        val maxThreadsHintPercent: Int? = null,
        val affinity: List<Int>? = null
    )

    data class RandomX(val mode: String = "auto")

    data class Network(
        val autoReconnect: Boolean = true,
        val retries: Int = 5,
        val retryPauseSec: Int = 5
    )

    data class Locks(val fields: List<String> = emptyList())

    companion object {
        const val SCHEMA_VERSION = 1
    }
}
