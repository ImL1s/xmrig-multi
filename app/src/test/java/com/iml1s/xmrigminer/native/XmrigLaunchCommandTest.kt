package com.iml1s.xmrigminer.native

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class XmrigLaunchCommandTest {

    @Test
    fun `build uses config file and thread count`() {
        val config = File("/tmp/config.json")
        val args = XmrigLaunchCommand.build("/data/libxmrig.so", config, 4)

        assertEquals("/data/libxmrig.so", args[0])
        assertEquals("-c", args[1])
        assertTrue(args[2].endsWith("config.json"))
        assertEquals("-t", args[3])
        assertEquals("4", args[4])
        assertTrue(args.contains("--no-color"))
    }

    @Test
    fun `auto mode omits -t so max-threads-hint can apply`() {
        val args = XmrigLaunchCommand.build("/bin/xmrig", File("config.json"), null)
        assertFalse(args.contains("-t"))
        assertTrue(args.contains("-c"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `build rejects zero threads`() {
        XmrigLaunchCommand.build("/bin/xmrig", File("config.json"), 0)
    }
}
