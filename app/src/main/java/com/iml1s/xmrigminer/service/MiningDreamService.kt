package com.iml1s.xmrigminer.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
import android.service.dreams.DreamService
import android.widget.FrameLayout
import android.widget.TextView
import com.iml1s.xmrigminer.data.ambient.WallClockDisplay
import com.iml1s.xmrigminer.data.ambient.WallClockTicker
import com.iml1s.xmrigminer.data.repository.ConfigRepository
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import timber.log.Timber
import javax.inject.Inject

/**
 * Charging screensaver (#76/#127). Clock ticks while dreaming; mine only via [MiningController].
 * Preview never mines. Stopping the dream clears dream-scope flags only — does not user-stop.
 */
@AndroidEntryPoint
class MiningDreamService : DreamService() {

    @Inject lateinit var miningController: MiningController
    @Inject lateinit var configRepository: ConfigRepository

    private var phase = DreamMiningPolicy.Phase.PREVIEW
    private var clockView: TextView? = null
    private var statusView: TextView? = null

    private val handler = Handler(Looper.getMainLooper())
    private val display = WallClockDisplay()
    private var ticker: WallClockTicker? = null
    private var timeReceiverRegistered = false

    private val serviceJob = SupervisorJob()
    private val serviceScope = CoroutineScope(serviceJob + Dispatchers.Main.immediate)

    /** Dream-scoped: we asked controller once this dream; cleared on stop/detach. */
    private var dreamMineRequested = false
    private var lastRejectReason: String? = null
    private var lastDecision: DreamMiningPolicy.Decision? = null

    /** Test hooks — production reads DataStore + latch; these override when non-null. */
    var testOverrideOptIn: Boolean? = null
    var testOverridePowerAllows: Boolean? = null
    var testOverrideRuntimeEligible: Boolean? = null
    var testOverrideUserStopped: Boolean? = null
    var testControllerStart: (suspend () -> MiningStartResult)? = null

    var mineRequestCount: Int = 0
        private set
    var mineAcceptedCount: Int = 0
        private set

    private val timeReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            display.invalidateTimeZone()
            ticker?.resync()
        }
    }

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
        statusView = TextView(this).also {
            it.textSize = 14f
            it.setTextColor(0x99F2EDE4.toInt())
            root.addView(it)
        }
        setContentView(root)
        startClockTicker()
        registerTimeReceiver()
    }

    override fun onDreamingStarted() {
        super.onDreamingStarted()
        phase = DreamMiningPolicy.Phase.DREAMING
        startClockTicker()
        serviceScope.launch { applyDecisionAsync() }
    }

    override fun onDreamingStopped() {
        phase = DreamMiningPolicy.Phase.STOPPED
        // Clear dream-scoped mine flag only — do not call MiningController.stop().
        dreamMineRequested = false
        lastRejectReason = null
        stopClockTicker()
        lastDecision = DreamMiningPolicy.decide(
            phase = phase,
            userOptedInClockAndMine = false,
            powerAllows = false,
            runtimeEligible = false,
            userStopped = true
        )
        super.onDreamingStopped()
    }

    override fun onDetachedFromWindow() {
        stopClockTicker()
        unregisterTimeReceiver()
        dreamMineRequested = false
        clockView = null
        statusView = null
        serviceJob.cancel()
        super.onDetachedFromWindow()
    }

    /** Sync entry used by unit tests with overrides already set. */
    fun applyDecision(): DreamMiningPolicy.Decision {
        val decision = DreamMiningPolicy.decide(
            phase = phase,
            userOptedInClockAndMine = testOverrideOptIn ?: false,
            powerAllows = testOverridePowerAllows ?: false,
            runtimeEligible = testOverrideRuntimeEligible ?: false,
            userStopped = testOverrideUserStopped ?: MiningSessionLatch.isUserStopped()
        )
        lastDecision = decision
        if (DreamMineBridge.shouldRequest(decision, dreamMineRequested)) {
            mineRequestCount++
            dreamMineRequested = true
            // Production path uses applyDecisionAsync; tests may inject controller.
        }
        return decision
    }

    fun forcePreviewPhaseForTest() {
        phase = DreamMiningPolicy.Phase.PREVIEW
    }

    fun forceDreamingPhaseForTest() {
        phase = DreamMiningPolicy.Phase.DREAMING
    }

    fun lastDecisionForTest(): DreamMiningPolicy.Decision? = lastDecision

    fun dreamMineRequestedForTest(): Boolean = dreamMineRequested

    private suspend fun applyDecisionAsync() {
        val snapshot = withContext(Dispatchers.IO) {
            configRepository.getConfig().first()
        }
        val userStopped = testOverrideUserStopped ?: MiningSessionLatch.isUserStopped()
        val optedIn = testOverrideOptIn ?: snapshot.dreamMayMine
        val runtimeEligible = testOverrideRuntimeEligible
            ?: (snapshot.walletAddress.isNotBlank() && !userStopped)
        val powerAllows = testOverridePowerAllows ?: run {
            val obs = miningController.readPowerObservation()
            miningController.evaluatePowerGate(snapshot, obs) == null
        }
        val decision = DreamMiningPolicy.decide(
            phase = phase,
            userOptedInClockAndMine = optedIn,
            powerAllows = powerAllows,
            runtimeEligible = runtimeEligible,
            userStopped = userStopped
        )
        lastDecision = decision
        statusView?.text = decision.reasons.firstOrNull().orEmpty()
        if (!DreamMineBridge.shouldRequest(decision, dreamMineRequested)) {
            return
        }
        dreamMineRequested = true
        mineRequestCount++
        val starter = testControllerStart ?: { miningController.start() }
        val result = withContext(Dispatchers.IO) { starter() }
        val (keepRequested, outcome) = DreamMineBridge.afterControllerResult(result)
        dreamMineRequested = keepRequested
        lastRejectReason = outcome.rejectReason
        if (outcome.accepted) {
            mineAcceptedCount++
            MiningSessionLatch.setAutomationArmed(true)
            statusView?.text = "Mining requested"
        } else {
            statusView?.text = outcome.rejectReason ?: "Mine request rejected"
            Timber.i("Dream mine rejected: %s", outcome.rejectReason)
        }
    }

    private fun startClockTicker() {
        if (ticker?.isRunning() == true) return
        ticker = WallClockTicker(
            display = display,
            schedule = { delayMs, task -> handler.postDelayed(task, delayMs) },
            cancel = { task -> handler.removeCallbacks(task) },
            onTick = { snap ->
                clockView?.text = snap.text
            }
        ).also { it.start() }
    }

    private fun stopClockTicker() {
        ticker?.stop()
        ticker = null
    }

    private fun registerTimeReceiver() {
        if (timeReceiverRegistered) return
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_TIME_CHANGED)
            addAction(Intent.ACTION_TIMEZONE_CHANGED)
            addAction(Intent.ACTION_TIME_TICK)
        }
        registerReceiver(timeReceiver, filter)
        timeReceiverRegistered = true
    }

    private fun unregisterTimeReceiver() {
        if (!timeReceiverRegistered) return
        runCatching { unregisterReceiver(timeReceiver) }
        timeReceiverRegistered = false
    }
}
