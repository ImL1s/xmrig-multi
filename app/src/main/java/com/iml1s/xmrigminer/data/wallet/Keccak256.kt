package com.iml1s.xmrigminer.data.wallet

/**
 * Original Keccak-256 (NOT NIST SHA3) for Monero checksums (#53).
 */
@OptIn(ExperimentalUnsignedTypes::class)
internal object Keccak256 {
    private val RC = ulongArrayOf(
        0x0000000000000001uL, 0x0000000000008082uL, 0x800000000000808auL,
        0x8000000080008000uL, 0x000000000000808buL, 0x0000000080000001uL,
        0x8000000080008081uL, 0x8000000000008009uL, 0x000000000000008auL,
        0x0000000000000088uL, 0x0000000080008009uL, 0x000000008000000auL,
        0x000000008000808buL, 0x800000000000008buL, 0x8000000000008089uL,
        0x8000000000008003uL, 0x8000000000008002uL, 0x8000000000000080uL,
        0x000000000000800auL, 0x800000008000000auL, 0x8000000080008081uL,
        0x8000000000008080uL, 0x0000000080000001uL, 0x8000000080008008uL
    )
    private val ROTC = intArrayOf(
        1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14,
        27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44
    )
    private val PILN = intArrayOf(
        10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4,
        15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1
    )

    fun hash(message: ByteArray): ByteArray {
        val s = ULongArray(25)
        val rate = 136
        var offset = 0
        while (offset + rate <= message.size) {
            absorb(s, message, offset, rate)
            keccakF(s)
            offset += rate
        }
        val block = ByteArray(rate)
        val rem = message.size - offset
        System.arraycopy(message, offset, block, 0, rem)
        block[rem] = 0x01
        block[rate - 1] = (block[rate - 1].toInt() or 0x80).toByte()
        absorb(s, block, 0, rate)
        keccakF(s)
        val out = ByteArray(32)
        for (i in 0 until 4) {
            var v = s[i]
            for (j in 0 until 8) {
                out[i * 8 + j] = (v and 0xffuL).toByte()
                v = v shr 8
            }
        }
        return out
    }

    private fun absorb(s: ULongArray, src: ByteArray, offset: Int, len: Int) {
        var i = 0
        while (i < len) {
            var x = 0uL
            for (j in 0 until 8) {
                x = x or ((src[offset + i + j].toULong() and 0xffuL) shl (8 * j))
            }
            s[i / 8] = s[i / 8] xor x
            i += 8
        }
    }

    private fun rotl(x: ULong, n: Int): ULong = (x shl n) or (x shr (64 - n))

    private fun keccakF(s: ULongArray) {
        val bc = ULongArray(5)
        for (round in 0 until 24) {
            for (i in 0 until 5) {
                bc[i] = s[i] xor s[i + 5] xor s[i + 10] xor s[i + 15] xor s[i + 20]
            }
            for (i in 0 until 5) {
                val t = bc[(i + 4) % 5] xor rotl(bc[(i + 1) % 5], 1)
                var j = 0
                while (j < 25) {
                    s[j + i] = s[j + i] xor t
                    j += 5
                }
            }
            var t = s[1]
            for (i in 0 until 24) {
                val j = PILN[i]
                val tmp = s[j]
                s[j] = rotl(t, ROTC[i])
                t = tmp
            }
            var j = 0
            while (j < 25) {
                for (i in 0 until 5) bc[i] = s[j + i]
                for (i in 0 until 5) {
                    s[j + i] = s[j + i] xor ((bc[(i + 1) % 5].inv()) and bc[(i + 2) % 5])
                }
                j += 5
            }
            s[0] = s[0] xor RC[round]
        }
    }
}
