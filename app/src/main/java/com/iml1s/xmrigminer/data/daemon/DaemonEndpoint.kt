package com.iml1s.xmrigminer.data.daemon

/**
 * Android port of shared/daemon-endpoint (#44).
 * Fixes http://host mis-parse and refuses TCP-only “ready” claims.
 */
object DaemonEndpoint {

    const val DEFAULT_PORT = 18081

    data class Parsed(
        val ok: Boolean,
        val host: String? = null,
        val port: Int? = null,
        val scheme: String? = null,
        val tls: Boolean = false,
        val engineUrl: String? = null,
        val isLoopback: Boolean = false,
        val hasUserinfo: Boolean = false,
        val path: String = "",
        val code: String? = null,
        val error: String? = null,
        val warning: String? = null
    )

    data class Preflight(
        val ok: Boolean,
        val stage: String,
        val code: String,
        val error: String? = null,
        val hint: String? = null,
        val parsed: Parsed? = null,
        val tcpOnly: Boolean = false
    )

    fun parse(raw: String?, allowHttps: Boolean = true): Parsed {
        if (raw.isNullOrBlank()) {
            return Parsed(ok = false, code = "empty", error = "daemon URL is required")
        }
        var input = raw.trim().replace(Regex("[\\u200B-\\u200D\\uFEFF]"), "")
        var hasUserinfo = false
        var scheme: String? = null
        var path = ""

        val schemeMatch = Regex("^(https?)://", RegexOption.IGNORE_CASE).find(input)
        if (schemeMatch != null) {
            scheme = schemeMatch.groupValues[1].lowercase()
            input = input.substring(schemeMatch.value.length)
            if (scheme == "https" && !allowHttps) {
                return Parsed(
                    ok = false,
                    code = "tls_unsupported",
                    error = "https daemon requires TLS capability — refusing silent http downgrade"
                )
            }
        }

        val at = input.lastIndexOf('@')
        if (at != -1) {
            hasUserinfo = true
            input = input.substring(at + 1)
        }

        val pathIdx = input.indexOfFirst { it == '/' || it == '?' || it == '#' }
        if (pathIdx != -1) {
            path = input.substring(pathIdx).substringBefore('?').substringBefore('#')
            input = input.substring(0, pathIdx)
        }

        val host: String
        val port: Int
        if (input.startsWith("[")) {
            val end = input.indexOf(']')
            if (end == -1) return Parsed(ok = false, code = "bad_ipv6", error = "IPv6 host missing closing bracket")
            host = input.substring(1, end).lowercase()
            val rest = input.substring(end + 1)
            port = when {
                rest.startsWith(":") -> parsePort(rest.substring(1))
                    ?: return Parsed(ok = false, code = "bad_port", error = "port out of range")
                rest.isEmpty() -> DEFAULT_PORT
                else -> return Parsed(ok = false, code = "bad_ipv6", error = "unexpected characters after IPv6 host")
            }
        } else {
            val colon = input.lastIndexOf(':')
            val colonCount = input.count { it == ':' }
            if (colon != -1 && colonCount == 1) {
                host = input.substring(0, colon).lowercase()
                port = parsePort(input.substring(colon + 1))
                    ?: return Parsed(ok = false, code = "bad_port", error = "port out of range or non-numeric")
            } else if (colonCount > 1) {
                host = input.lowercase()
                port = DEFAULT_PORT
            } else {
                host = input.lowercase()
                port = DEFAULT_PORT
            }
        }

        if (host.isBlank() || host.contains(' ')) {
            return Parsed(ok = false, code = "bad_host", error = "invalid host")
        }
        if (host == "http" || host == "https") {
            return Parsed(
                ok = false,
                code = "bad_host",
                error = "scheme was parsed as host — use http://host:port"
            )
        }

        val engineUrl = if (host.contains(':')) "[$host]:$port" else "$host:$port"
        return Parsed(
            ok = true,
            host = host,
            port = port,
            scheme = scheme,
            tls = scheme == "https",
            engineUrl = engineUrl,
            isLoopback = host == "localhost" || host == "127.0.0.1" || host == "::1",
            hasUserinfo = hasUserinfo,
            path = path,
            warning = if (hasUserinfo) {
                "URI userinfo ignored — put RPC credentials in a separate secret field"
            } else null
        )
    }

    /**
     * TCP-only probe is insufficient for “ready to mine”.
     * Callers must run JSON-RPC get_info; this helper encodes that gate.
     */
    fun preflightAfterTcp(
        raw: String?,
        tcpOk: Boolean,
        tcpError: String? = null,
        allowHttps: Boolean = true,
        rpcSynchronized: Boolean? = null,
        rpcNettype: String? = null,
        rpcError: String? = null,
        expectedMainnet: Boolean = true,
        rpcProbed: Boolean = false
    ): Preflight {
        val parsed = parse(raw, allowHttps)
        if (!parsed.ok) {
            return Preflight(false, "parse", parsed.code ?: "parse", parsed.error, hintFor(parsed.code), parsed)
        }
        if (!tcpOk) {
            return Preflight(
                ok = false,
                stage = "tcp",
                code = "tcp_fail",
                error = tcpError ?: "TCP connect failed",
                hint = if (parsed.isLoopback) {
                    "127.0.0.1 on a phone is the phone itself — run monerod on-device or use a LAN IP"
                } else {
                    "Check host/port, firewall, and that monerod is listening"
                },
                parsed = parsed
            )
        }
        if (!rpcProbed) {
            return Preflight(
                ok = false,
                stage = "rpc",
                code = "rpc_required",
                error = "TCP reachable is not proof the node can mine — RPC probe required",
                hint = "Call get_info before start; do not treat TCP as mining-ready",
                parsed = parsed,
                tcpOnly = true
            )
        }
        if (rpcError != null) {
            val restricted = rpcError.contains("restricted", true) ||
                rpcError.contains("forbidden", true) ||
                rpcError.contains("unauthorized", true)
            return Preflight(
                ok = false,
                stage = "rpc",
                code = if (restricted) "rpc_restricted" else "rpc_error",
                error = rpcError,
                hint = if (restricted) {
                    "RPC rejected the call — enable mining methods or use unrestricted credentials"
                } else "JSON-RPC error from daemon",
                parsed = parsed
            )
        }
        if (rpcSynchronized == false) {
            return Preflight(
                ok = false,
                stage = "sync",
                code = "syncing",
                error = "daemon is still synchronizing",
                hint = "Wait until monerod finishes sync before solo mining",
                parsed = parsed
            )
        }
        if (expectedMainnet && rpcNettype != null &&
            !rpcNettype.equals("mainnet", true)
        ) {
            return Preflight(
                ok = false,
                stage = "network",
                code = "wrong_network",
                error = "daemon nettype=$rpcNettype",
                hint = "Wallet network and daemon network must match",
                parsed = parsed
            )
        }
        return Preflight(true, "ready", "ok", parsed = parsed)
    }

    /** Normalize user input to XMRig daemon url form when parse succeeds. */
    fun toEngineUrl(raw: String?): String? = parse(raw).engineUrl

    private fun parsePort(part: String): Int? {
        if (!part.all { it.isDigit() }) return null
        val n = part.toIntOrNull() ?: return null
        return n.takeIf { it in 1..65535 }
    }

    private fun hintFor(code: String?): String = when (code) {
        "empty" -> "Enter monerod RPC as host:port or http://host:port"
        "bad_host" -> "Check hostname — http://host:port was mis-parsed historically as host \"http\""
        "bad_port" -> "Port must be 1–65535; omit port to default to 18081"
        "bad_ipv6" -> "Use [2001:db8::1]:18081 form for IPv6 with port"
        "tls_unsupported" -> "This build cannot use https daemons"
        else -> "Fix the daemon URL and retry"
    }
}
