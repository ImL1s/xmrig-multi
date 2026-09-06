package com.iml1s.xmrigminer.data.daemon

/**
 * Typed monerod endpoint parser (#44).
 * Never silently remaps to another host/port; https rejected when unsupported.
 */
object DaemonEndpointParser {

    const val DEFAULT_PORT = 18081

    data class Endpoint(
        val host: String,
        val port: Int,
        val scheme: String,
        val path: String,
        val engineUrl: String,
        val isLoopback: Boolean,
        val hasUserinfo: Boolean
    )

    data class Result(
        val ok: Boolean,
        val endpoint: Endpoint? = null,
        val code: String = "",
        val message: String = ""
    )

    fun parse(raw: String?, allowHttps: Boolean = false): Result {
        if (raw.isNullOrBlank()) {
            return fail("empty", "Daemon RPC URL is required")
        }
        val input = raw.trim()
        if (input.any { it.isWhitespace() }) {
            return fail("whitespace", "Daemon URL must not contain whitespace")
        }

        var scheme: String? = null
        var rest = input
        val schemeRegex = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*)://")
        val schemeMatch = schemeRegex.find(input)
        if (schemeMatch != null) {
            scheme = schemeMatch.groupValues[1].lowercase()
            rest = input.substring(schemeMatch.value.length)
            when {
                scheme == "https" && !allowHttps ->
                    return fail(
                        "https_unsupported",
                        "HTTPS daemon RPC is not supported in this build; use http:// or host:port"
                    )
                scheme == "http" || (scheme == "https" && allowHttps) -> Unit
                else -> return fail("scheme", "Unsupported daemon URI scheme: $scheme")
            }
        }

        var hasUserinfo = false
        val authority = rest.substringBefore('/')
        if (authority.contains('@')) {
            hasUserinfo = true
            val at = rest.lastIndexOf('@')
            // only strip if @ is in authority portion
            val slashIdx = rest.indexOf('/')
            if (slashIdx < 0 || at < slashIdx) {
                rest = rest.substring(at + 1)
            }
        }

        val path: String
        val hostPort: String
        val slash = rest.indexOf('/')
        if (slash >= 0) {
            hostPort = rest.substring(0, slash)
            path = rest.substring(slash).trimEnd('/')
        } else {
            hostPort = rest
            path = ""
        }
        if (hostPort.isEmpty()) return fail("host", "Daemon host is missing")

        val host: String
        var portStr: String? = null
        if (hostPort.startsWith("[")) {
            val end = hostPort.indexOf(']')
            if (end < 0) return fail("ipv6", "Unclosed IPv6 bracket")
            host = hostPort.substring(1, end)
            val after = hostPort.substring(end + 1)
            when {
                after.isEmpty() -> portStr = null
                after.startsWith(":") -> {
                    portStr = after.substring(1)
                    if (portStr.isEmpty()) return fail("port", "Empty port after IPv6 host")
                }
                else -> return fail("ipv6", "Garbage after IPv6 address")
            }
            if (!isIpv6(host)) return fail("ipv6", "Invalid IPv6 address")
        } else {
            val colonCount = hostPort.count { it == ':' }
            when {
                colonCount > 1 -> return fail("ipv6", "Bare IPv6 requires brackets: [addr]:port")
                colonCount == 1 -> {
                    val idx = hostPort.indexOf(':')
                    host = hostPort.substring(0, idx)
                    portStr = hostPort.substring(idx + 1)
                    if (portStr.isEmpty()) return fail("port", "Empty port")
                }
                else -> host = hostPort
            }
        }

        if (host.isEmpty()) return fail("host", "Daemon host is missing")
        if (host.any { it.code > 0x7e }) {
            return fail("idn", "Non-ASCII hostnames (IDN) are not supported; use ASCII / punycode")
        }
        if (!isValidHostnameOrIp(host)) {
            return fail("host", "Invalid daemon hostname or IP")
        }

        val port = if (portStr != null) {
            if (!portStr.all { it.isDigit() }) return fail("port", "Invalid port: $portStr")
            val p = portStr.toIntOrNull() ?: return fail("port", "Invalid port: $portStr")
            if (p !in 1..65535) return fail("port", "Port out of range: $portStr")
            p
        } else {
            DEFAULT_PORT
        }

        val engineUrl = if (isIpv6(host)) "[$host]:$port" else "$host:$port"
        return Result(
            ok = true,
            endpoint = Endpoint(
                host = host,
                port = port,
                scheme = scheme ?: "http",
                path = path,
                engineUrl = engineUrl,
                isLoopback = isLoopbackHost(host),
                hasUserinfo = hasUserinfo
            )
        )
    }

    fun isLoopbackHost(host: String): Boolean {
        val h = host.lowercase()
        if (h == "localhost" || h == "127.0.0.1" || h == "::1" || h == "0:0:0:0:0:0:0:1") return true
        if (isIpv4(h) && h.startsWith("127.")) return true
        return false
    }

    private fun fail(code: String, message: String) = Result(ok = false, code = code, message = message)

    private fun isIpv6(host: String): Boolean {
        if (host.isBlank() || ' ' in host) return false
        if (':' !in host) return false
        return host.all { it.isDigit() || it in 'a'..'f' || it in 'A'..'F' || it == ':' || it == '.' }
    }

    private fun isIpv4(host: String): Boolean {
        val parts = host.split('.')
        if (parts.size != 4) return false
        return parts.all { p ->
            val n = p.toIntOrNull() ?: return false
            n in 0..255 && p == n.toString()
        }
    }

    private fun isValidHostnameOrIp(host: String): Boolean {
        if (isIpv4(host) || isIpv6(host)) return true
        if (host == "localhost") return true
        if (host.length > 253 || host.startsWith('.') || host.endsWith('.')) return false
        val label = Regex("^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$")
        return host.split('.').all { label.matches(it) }
    }
}
