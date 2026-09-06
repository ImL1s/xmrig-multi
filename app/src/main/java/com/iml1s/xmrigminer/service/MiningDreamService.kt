package com.iml1s.xmrigminer.service

import android.service.dreams.DreamService
import android.widget.FrameLayout
import android.widget.TextView
import com.iml1s.xmrigminer.data.ambient.AmbientClockPolicy
import java.util.Calendar

/**
 * Charging screensaver entry (#76). Presentation only + gated mine requests.
 * Does not embed RandomX or talk to pools directly.
 */
class MiningDreamService : DreamService() {

    private var phase = DreamMiningPolicy.Phase.PREVIEW
    private var clockView: TextView? = null

    /** Injected for tests; production stays false until user setting + controller wiring. */
    var userOptedInClockAndMine: Boolean = false
    var powerAllows: Boolean = false
    var runtimeEligible: Boolean = false
    var userStopped: Boolean = false

    /** Side-effect counter for tests — production would call MiningController. */
    var mineRequestCount: Int = 0
        private set

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        isInteractive = false
        isFullscreen = true
        val root = FrameLayout(this)
        clockView = TextView(this).also {
            it.textSize = 64f
            it.setTextColor(0xFFF2EDE4.toInt())
            root.addView(it)
        }
        setContentView(root)
        refreshClock()
    }

    override fun onDreamingStarted() {
        super.onDreamingStarted()
        phase = DreamMiningPolicy.Phase.DREAMING
        applyDecision()
        refreshClock()
    }

    override fun onDreamingStopped() {
        phase = DreamMiningPolicy.Phase.STOPPED
        // Do not stop an independently authorized charging session — only clear dream-scoped requests.
        applyDecision()
        super.onDreamingStopped()
    }

    override fun onDetachedFromWindow() {
        clockView = null
        super.onDetachedFromWindow()
    }

    fun applyDecision(): DreamMiningPolicy.Decision {
        val decision = DreamMiningPolicy.decide(
            phase = phase,
            userOptedInClockAndMine = userOptedInClockAndMine,
            powerAllows = powerAllows,
            runtimeEligible = runtimeEligible,
            userStopped = userStopped
        )
        if (decision.mayRequestMine) {
            mineRequestCount++
            // Production: MiningController.requestStart(from = "dream")
        }
        return decision
    }

    fun forcePreviewPhaseForTest() {
        phase = DreamMiningPolicy.Phase.PREVIEW
    }

    private fun refreshClock() {
        val cal = Calendar.getInstance()
        clockView?.text = AmbientClockPolicy.formatWallClock(
            hours = cal.get(Calendar.HOUR_OF_DAY),
            minutes = cal.get(Calendar.MINUTE),
            showSeconds = false
        )
    }
}
