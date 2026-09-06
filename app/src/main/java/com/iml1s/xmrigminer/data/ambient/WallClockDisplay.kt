package com.iml1s.xmrigminer.data.ambient

import java.util.Calendar
import java.util.TimeZone

/**
 * Injectable wall-clock snapshot for AmbientScreen + MiningDreamService (#127).
 * [nowMs] and calendar factory are overridable for fake-clock tests.
 */
class WallClockDisplay(
    private val nowMs: () -> Long = System::currentTimeMillis,
    private val calendarAt: (Long) -> Calendar = { ms ->
        Calendar.getInstance().also { it.timeInMillis = ms }
    }
) {
    data class Snapshot(
        val text: String,
        val minuteOfDay: Int,
        val nextDelayMs: Long,
        val epochMs: Long
    )

    fun snapshot(showSeconds: Boolean = false): Snapshot {
        val ms = nowMs()
        val cal = calendarAt(ms)
        val hours = cal.get(Calendar.HOUR_OF_DAY)
        val minutes = cal.get(Calendar.MINUTE)
        val seconds = cal.get(Calendar.SECOND)
        return Snapshot(
            text = AmbientClockPolicy.formatWallClock(
                hours = hours,
                minutes = minutes,
                seconds = seconds,
                showSeconds = showSeconds
            ),
            minuteOfDay = hours * 60 + minutes,
            nextDelayMs = AmbientClockPolicy.nextTickMs(ms, showSeconds = showSeconds),
            epochMs = ms
        )
    }

    /** Rebuild calendar after TZ / manual time change so next snapshot is correct. */
    fun invalidateTimeZone(zone: TimeZone = TimeZone.getDefault()) {
        // Calendar.getInstance() already uses default TZ; hook kept for test spies.
        @Suppress("UNUSED_VARIABLE")
        val unused = zone
    }
}

/**
 * Lifecycle-aware minute (or second) ticker. Caller must [stop] on detach — no residual schedule.
 */
class WallClockTicker(
    private val display: WallClockDisplay,
    private val schedule: (delayMs: Long, task: Runnable) -> Unit,
    private val cancel: (task: Runnable) -> Unit,
    private val onTick: (WallClockDisplay.Snapshot) -> Unit,
    private val showSeconds: Boolean = false
) {
    @Volatile
    private var running = false

    private lateinit var task: Runnable

    init {
        task = Runnable {
            if (!running) return@Runnable
            val snap = display.snapshot(showSeconds = showSeconds)
            onTick(snap)
            if (running) {
                schedule(snap.nextDelayMs.coerceAtLeast(250L), task)
            }
        }
    }

    fun start() {
        stop()
        running = true
        task.run()
    }

    fun stop() {
        running = false
        cancel(task)
    }

    fun isRunning(): Boolean = running

    /** Immediate refresh + reschedule (TIME_CHANGED / TIMEZONE_CHANGED). */
    fun resync() {
        if (!running) return
        cancel(task)
        task.run()
    }
}
