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
    fun `killByCommandLine is safe when nothing matches`() {
        assertEquals(0, XmrigProcessController.killByCommandLine("definitely-not-a-real-process-name-xyz"))
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
