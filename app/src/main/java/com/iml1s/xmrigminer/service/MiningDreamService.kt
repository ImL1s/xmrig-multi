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
import androidx.core.content.ContextCompat
import com.iml1s.xmrigminer.data.ambient.WallClockDisplay
import com.iml1s.xmrigminer.data.ambient.WallClockTicker
import com.iml1s.xmrigminer.data.repository.ConfigRepository
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
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
    private var mineJob: Job? = null

    /** Test hooks — production reads DataStore + latch; these override when non-null. */
    var testOverrideOptIn: Boolean? = null
    var testOverridePowerAllows: Boolean? = null
    var testOverrideRuntimeEligible: Boolean? = null
    var testOverrideUserStopped: Boolean? = null
    var testControllerStart: (suspend () -> MiningStartResult)? = null

    private var mineSession: DreamMineSession? = null

    val mineRequestCount: Int get() = mineSession?.requestCount ?: 0
    val mineAcceptedCount: Int get() = mineSession?.acceptedCount ?: 0

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
        mineJob?.cancel()
        mineJob = serviceScope.launch { applyDecisionAsync() }
    }

    override fun onDreamingStopped() {
        phase = DreamMiningPolicy.Phase.STOPPED
        mineJob?.cancel()
        mineJob = null
        mineSession?.onDreamStopped()
        stopClockTicker()
        super.onDreamingStopped()
    }

    override fun onDetachedFromWindow() {
        phase = DreamMiningPolicy.Phase.STOPPED
        mineJob?.cancel()
        mineJob = null
        stopClockTicker()
        unregisterTimeReceiver()
        mineSession?.onDreamStopped()
        clockView = null
        statusView = null
        serviceJob.cancel()
        super.onDetachedFromWindow()
    }

    /** Decision-only for tests — does not call MiningController. */
    fun evaluateDecisionForTest(
        optedIn: Boolean,
        powerAllows: Boolean,
        runtimeEligible: Boolean,
        userStopped: Boolean
    ): DreamMiningPolicy.Decision {
        return DreamMiningPolicy.decide(
            phase = phase,
            userOptedInClockAndMine = optedIn,
            powerAllows = powerAllows,
            runtimeEligible = runtimeEligible,
            userStopped = userStopped
        )
    }

    fun forcePreviewPhaseForTest() {
        phase = DreamMiningPolicy.Phase.PREVIEW
    }

    fun forceDreamingPhaseForTest() {
        phase = DreamMiningPolicy.Phase.DREAMING
    }

    private suspend fun applyDecisionAsync() {
        val snapshot = withContext(Dispatchers.IO) {
            configRepository.getConfig().first()
        }
        if (phase != DreamMiningPolicy.Phase.DREAMING) return

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
        statusView?.text = decision.reasons.firstOrNull().orEmpty()

        val starter = testControllerStart ?: { miningController.start() }
        val session = mineSession ?: DreamMineSession(
            startMining = starter,
            stillDreaming = { phase == DreamMiningPolicy.Phase.DREAMING }
        ).also { mineSession = it }

        val outcome = session.maybeRequest(decision) ?: return
        if (outcome.accepted) {
            MiningSessionLatch.setAutomationArmed(true)
            statusView?.text = "Mining requested"
        } else if (outcome.requested) {
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
        ContextCompat.registerReceiver(
            this,
            timeReceiver,
            filter,
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
        timeReceiverRegistered = true
    }

    private fun unregisterTimeReceiver() {
        if (!timeReceiverRegistered) return
        runCatching { unregisterReceiver(timeReceiver) }
        timeReceiverRegistered = false
    }
}
