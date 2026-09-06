package com.iml1s.xmrigminer.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ProcStatCpuTest {

    @Test
    fun `parses utime stime when comm has spaces`() {
        // pid (comm with spaces) state ppid ... utime stime
        val line =
            "1234 (xmrig worker) R 1 1 1 0 -1 0 0 0 0 0 100 50 0 0 20 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0"
        // After ') ': indices 0=state ... 11=utime 12=stime — craft carefully
        val crafted =
            "42 (xmrig with spaces) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22"
        // Fields after comm: 0=S 1=1 2=2 ... we need utime at index 11, stime at 12
        val after = (0..20).joinToString(" ") { if (it == 11) "111" else if (it == 12) "22" else it.toString() }
        val text = "42 (xmrig with spaces) $after"
        assertEquals(133L, ProcStatCpu.parseCpuJiffies(text))
    }

    @Test
    fun `rejects malformed`() {
        assertNull(ProcStatCpu.parseCpuJiffies("bad"))
        assertNull(ProcStatCpu.parseCpuJiffies("1 (x"))
    }
}
