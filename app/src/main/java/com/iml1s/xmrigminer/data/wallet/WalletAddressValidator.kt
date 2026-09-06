package com.iml1s.xmrigminer.data.wallet

import java.math.BigInteger
import java.util.Locale

/**
 * Monero / WOW / DERO address validation (#53).
 * Monero checksum is Keccak-256 (not NIST SHA3). Checksum ≠ ownership.
 */
object WalletAddressValidator {

    private const val ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    private val DECODED_BLOCK_SIZES = intArrayOf(0, 2, 3, 5, 6, 7, 9, 10, 11)

    data class Result(
        val ok: Boolean,
        val code: String,
        val message: String,
        val network: String? = null,
        val addressType: String? = null
    )

    fun validate(address: String?, coin: String, allowIntegrated: Boolean = true): Result {
        val raw = address?.trim().orEmpty()
        if (raw.isEmpty()) return Result(false, "empty", "Wallet address is required")
        if (raw.any { it.code < 0x20 || it.code == 0x7f }) {
            return Result(false, "illegal_char", "Address contains control characters")
        }
        if (raw.any { it.code > 0x7e }) {
            return Result(false, "unicode", "Address contains non-ASCII characters")
        }
        return when (coin.lowercase(Locale.US)) {
            "monero", "xmr", "MONERO".lowercase(Locale.US) -> validateMonero(raw, allowIntegrated)
            "wownero", "wow", "WOWNERO".lowercase(Locale.US) -> validateWownero(raw)
            "dero", "DERO".lowercase(Locale.US) -> validateDero(raw)
            else -> Result(false, "unsupported_coin", "Unsupported coin")
        }
    }

    fun parseInput(text: String?): Pair<String, List<String>> {
        val raw = text?.trim().orEmpty()
        if (raw.isEmpty()) return "" to listOf("empty")
        val m = Regex("^(monero|wownero|dero):([^?/\\s]+)(\\?.*)?$", RegexOption.IGNORE_CASE).matchEntire(raw)
        if (m != null) {
            val query = m.groupValues.getOrNull(3).orEmpty()
            if (Regex("[;&]|start=|donate=|pool=", RegexOption.IGNORE_CASE).containsMatchIn(query)) {
                return "" to listOf("URI contains disallowed parameters — paste address only")
            }
            val warnings = if (query.isNotEmpty()) {
                listOf("URI query ignored — review before mining; never auto-start")
            } else emptyList()
            return m.groupValues[2] to warnings
        }
        return raw to emptyList()
    }

    private fun validateMonero(address: String, allowIntegrated: Boolean): Result {
        if (address.any { ALPHABET.indexOf(it) < 0 }) {
            return Result(false, "charset", "Monero address has illegal Base58 characters")
        }
        val okLen = when (address.length) {
            95 -> true
            106 -> allowIntegrated
            else -> false
        }
        if (!okLen) {
            return Result(false, "length", "Monero address length ${address.length} invalid")
        }
        val bytes = cnBase58Decode(address) ?: return Result(false, "base58", "Monero Base58 decode failed")
        val expect = if (address.length == 95) 69 else 77
        if (bytes.size != expect) {
            return Result(false, "decoded_length", "Decoded length mismatch")
        }
        val payload = bytes.copyOfRange(0, bytes.size - 4)
        val checksum = bytes.copyOfRange(bytes.size - 4, bytes.size)
        val hash = keccak256(payload)
        for (i in 0..3) {
            if (hash[i] != checksum[i]) {
                return Result(false, "checksum", "Monero checksum mismatch (typo or truncated address)")
            }
        }
        val classified = classifyNetbyte(bytes[0].toInt() and 0xff)
            ?: return Result(false, "network_byte", "Unknown Monero network byte")
        if (classified.second == "integrated" && !allowIntegrated) {
            return Result(false, "integrated_disabled", "Integrated addresses are not enabled")
        }
        if (classified.first != "mainnet") {
            return Result(
                false,
                "network",
                "Address is ${classified.first} ${classified.second}; mainnet required",
                classified.first,
                classified.second
            )
        }
        return Result(true, "ok", "${classified.first} ${classified.second} address", classified.first, classified.second)
    }

    private fun classifyNetbyte(b: Int): Pair<String, String>? = when (b) {
        0x12 -> "mainnet" to "standard"
        0x13 -> "mainnet" to "integrated"
        0x2a -> "mainnet" to "subaddress"
        0x35 -> "testnet" to "standard"
        0x36 -> "testnet" to "integrated"
        0x3f -> "testnet" to "subaddress"
        0x18 -> "stagenet" to "standard"
        0x19 -> "stagenet" to "integrated"
        0x24 -> "stagenet" to "subaddress"
        else -> null
    }

    private fun validateWownero(address: String): Result {
        if (!address.startsWith("Wo")) {
            return Result(false, "prefix", "Wownero address must start with Wo")
        }
        if (address.length !in 95..106) {
            return Result(false, "length", "Wownero address length out of range")
        }
        if (address.any { ALPHABET.indexOf(it) < 0 }) {
            return Result(false, "charset", "Wownero address has illegal characters")
        }
        return Result(true, "format_only", "Wownero format OK (checksum vectors not asserted)", "mainnet", "standard")
    }

    private fun validateDero(address: String): Result {
        val lower = address.lowercase(Locale.US)
        if (!lower.startsWith("dero")) {
            return Result(false, "prefix", "DERO address must start with dero")
        }
        if (address.length < 60) return Result(false, "length", "DERO address too short")
        if (!address.all { it.isLetterOrDigit() }) {
            return Result(false, "charset", "DERO address has illegal characters")
        }
        return Result(true, "format_only", "DERO format OK (bech32 checksum not asserted)", "mainnet", "standard")
    }

    private fun cnBase58Decode(str: String): ByteArray? {
        val fullBlockCount = str.length / 11
        val lastBlockSize = str.length % 11
        val lastDecodedSize = DECODED_BLOCK_SIZES.indexOf(lastBlockSize)
        if (lastBlockSize > 0 && lastDecodedSize < 0) return null
        val dataLen = fullBlockCount * 8 + if (lastBlockSize > 0) lastDecodedSize else 0
        val data = ByteArray(dataLen)
        for (i in 0 until fullBlockCount) {
            val enc = str.substring(i * 11, (i + 1) * 11)
            val dec = decodeBlock(enc, 8) ?: return null
            System.arraycopy(dec, 0, data, i * 8, 8)
        }
        if (lastBlockSize > 0) {
            val enc = str.substring(fullBlockCount * 11)
            val dec = decodeBlock(enc, lastDecodedSize) ?: return null
            System.arraycopy(dec, 0, data, fullBlockCount * 8, lastDecodedSize)
        }
        return data
    }

    private fun decodeBlock(enc: String, decodedSize: Int): ByteArray? {
        var num = BigInteger.ZERO
        for (ch in enc) {
            val digit = ALPHABET.indexOf(ch)
            if (digit < 0) return null
            num = num.multiply(BigInteger.valueOf(58)).add(BigInteger.valueOf(digit.toLong()))
        }
        val out = ByteArray(decodedSize)
        for (i in decodedSize - 1 downTo 0) {
            out[i] = num.and(BigInteger.valueOf(0xff)).toByte()
            num = num.shiftRight(8)
        }
        if (num != BigInteger.ZERO) return null
        return out
    }

    private fun keccak256(input: ByteArray): ByteArray = Keccak256.hash(input)
}
