package com.iml1s.xmrigminer.native

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class XmrigProcessControllerTest {

    @Test
    fun `stop returns true for null process`() {
        assertTrue(XmrigProcessController.stop(null))
    }

    @Test
    fun `stop kills a long-running process`() {
        val process = startSleeper()
        try {
            assertTrue(XmrigProcessController.isAlive(process))
            assertTrue(XmrigProcessController.stop(process, gracefulWaitMs = 500L))
            assertFalse(XmrigProcessController.isAlive(process))
        } finally {
            process.destroyForcibly()
        }
    }

    @Test
    fun `killLeftoverMiners is safe on JVM stubs`() {
        assertEquals(0, XmrigProcessController.killLeftoverMiners())
    }

    @Test
    fun `isMinerCommandLine matches packaged and extracted binaries only`() {
        assertTrue(
            XmrigProcessController.isMinerCommandLine(
                "/data/app/~~x/com.iml1s.xmrigminer.debug-y/lib/arm64/libxmrig.so\u0000-c\u0000/config.json"
            )
        )
        assertTrue(
            XmrigProcessController.isMinerCommandLine(
                "/data/user/0/com.iml1s.xmrigminer.debug/files/xmrig\u0000-c\u0000/config.json"
            )
        )
        assertFalse(
            XmrigProcessController.isMinerCommandLine(
                "com.iml1s.xmrigminer.debug"
            )
        )
        assertFalse(
            XmrigProcessController.isMinerCommandLine(
                "/system/bin/app_process64\u0000com.iml1s.xmrigminer.debug"
            )
        )
    }

    private fun startSleeper(): Process {
        val isWindows = System.getProperty("os.name").orEmpty().lowercase().contains("windows")
        val command = if (isWindows) {
            listOf("cmd", "/c", "ping", "-n", "30", "127.0.0.1")
        } else {
            listOf("sleep", "30")
        }
        val process = ProcessBuilder(command)
            .redirectErrorStream(true)
            .start()
        Thread.sleep(50)
        return process
    }
}
