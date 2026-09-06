package com.iml1s.xmrigminer.data.ambient

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone
import java.util.concurrent.atomic.AtomicLong

class WallClockTickerTest {

    @Test
    fun `fake clock advances two minutes yields two distinct display texts`() {
        val now = AtomicLong(
            Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
                set(2026, Calendar.SEPTEMBER, 6, 10, 0, 0)
                set(Calendar.MILLISECOND, 0)
            }.timeInMillis
        )
        val display = WallClockDisplay(
            nowMs = { now.get() },
            calendarAt = { ms ->
                Calendar.getInstance(TimeZone.getTimeZone("UTC")).also { it.timeInMillis = ms }
            }
        )
        val texts = mutableListOf<String>()
        var scheduled: Pair<Long, Runnable>? = null
        val ticker = WallClockTicker(
            display = display,
            schedule = { delay, task -> scheduled = delay to task },
            cancel = { scheduled = null },
            onTick = { texts += it.text }
        )
        ticker.start()
        assertEquals(listOf("10:00"), texts)

        now.addAndGet(60_000L)
        scheduled!!.second.run()
        assertEquals(listOf("10:00", "10:01"), texts)

        now.addAndGet(60_000L)
        scheduled!!.second.run()
        assertEquals(listOf("10:00", "10:01", "10:02"), texts)
    }

    @Test
    fun `stop cancels residual schedule`() {
        val display = WallClockDisplay(nowMs = { 0L })
        var cancelled = 0
        var scheduled = 0
        val ticker = WallClockTicker(
            display = display,
            schedule = { _, _ -> scheduled++ },
            cancel = { cancelled++ },
            onTick = { }
        )
        ticker.start()
        assertTrue(ticker.isRunning())
        ticker.stop()
        assertFalse(ticker.isRunning())
        assertTrue(cancelled >= 1)
        val scheduledAfterStop = scheduled
        ticker.stop()
        assertEquals(scheduledAfterStop, scheduled)
    }
}
