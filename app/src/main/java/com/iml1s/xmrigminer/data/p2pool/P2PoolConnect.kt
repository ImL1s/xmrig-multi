package com.iml1s.xmrigminer.data.p2pool

/**
 * Connect-existing P2Pool helpers (#45).
 * Stratum ≠ monerod RPC; never emit daemon:true for Stratum.
 */
object P2PoolConnect {
    const val DEFAULT_STRATUM_PORT = 3333
    const val DEFAULT_MONEROD_RPC_PORT = 18081

    data class StratumEndpoint(
        val host: String,
        val port: Int,
        val trust: String
    ) {
        val url: String get() = if (host.contains(":")) "[$host]:$port" else "$host:$port"
    }

    data class ParseResult(
        val ok: Boolean,
        val endpoint: StratumEndpoint? = null,
        val code: String? = null,
        val message: String? = null
    )

    fun parseStratum(input: String, allowRemote: Boolean = false): ParseResult {
        val raw = input.trim()
        if (raw.isEmpty()) return ParseResult(false, code = "empty", message = "P2Pool Stratum endpoint required")
        if (raw.startsWith("http://", true) || raw.startsWith("https://", true) || raw.contains("/json_rpc", true)) {
            return ParseResult(
                false,
                code = "looks_like_rpc",
                message = "This looks like monerod RPC — use the Stratum port (often 3333), not 18081"
            )
        }

        val host: String
        val port: Int
        if (raw.startsWith("[")) {
            val m = Regex("""^\[([^\]]+)]:(\d+)$""").matchEntire(raw)
                ?: return ParseResult(false, code = "bad_ipv6", message = "Expected [IPv6]:port")
            host = m.groupValues[1]
            port = m.groupValues[2].toIntOrNull()
                ?: return ParseResult(false, code = "bad_port", message = "Invalid Stratum port")
        } else {
            val idx = raw.lastIndexOf(':')
            if (idx <= 0) {
                host = raw
                port = DEFAULT_STRATUM_PORT
            } else {
                host = raw.substring(0, idx)
                port = raw.substring(idx + 1).toIntOrNull()
                    ?: return ParseResult(false, code = "bad_port", message = "Invalid Stratum port")
            }
        }
        if (port !in 1..65535) {
            return ParseResult(false, code = "bad_port", message = "Invalid Stratum port")
        }

        val trust = classifyTrust(host, allowRemote)
            ?: return ParseResult(
                false,
                code = "untrusted_host",
                message = "Only loopback or trusted LAN hosts allowed for connect-existing"
            )

        return ParseResult(true, StratumEndpoint(host, port, trust))
    }

    /**
     * Pool map for XMRig JSON — daemon must stay false.
     */
    fun stratumPoolFields(endpoint: StratumEndpoint, wallet: String, worker: String = "x"): Map<String, Any?> {
        return mapOf(
            "url" to endpoint.url,
            "user" to wallet.trim(),
            "pass" to worker,
            "keepalive" to true,
            "tls" to false,
            "daemon" to false
        )
    }

    fun feeDisclaimer(): String =
        "P2Pool has no centralized pool fee; payout timing depends on sidechain luck and hashrate. Not a payment guarantee. Sources: https://p2pool.io/ (asOf 2026-09-06)."

    private fun classifyTrust(host: String, allowRemote: Boolean): String? {
        val h = host.lowercase()
        if (h == "localhost" || h == "127.0.0.1" || h == "::1") return "loopback"
        if (
            h.matches(Regex("""^10\.\d+\.\d+\.\d+$""")) ||
            h.matches(Regex("""^192\.168\.\d+\.\d+$""")) ||
            h.matches(Regex("""^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$"""))
        ) {
            return "lan"
        }
        return if (allowRemote) "remote-explicit" else null
    }
}
