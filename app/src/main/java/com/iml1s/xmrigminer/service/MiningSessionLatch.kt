package com.iml1s.xmrigminer.service

import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Single persisted owner for Start/Stop/pause/automation intent (#124 / #123).
 *
 * Distinguishes:
 * - [latchUserStop]: permanent user intent until a validated Start arms again
 * - [latchPolicyPause]: temporary safety pause that does **not** become UserStopped
 * - engine replace/cleanup: no latch mutation (callers must not use [latchUserStop])
 *
 * Revisions use AtomicInteger so concurrent increments are race-safe. Process death restores
 * user-stop / armed / automation from [SessionIntentStore] (defaults deny automation).
 */
object MiningSessionLatch {
    private val userStopRev = AtomicInteger(0)
    private val sessionArmedRev = AtomicInteger(0)
    private val pauseUntilMs = AtomicLong(0L)
    private val policyPaused = AtomicBoolean(false)
    private val automationArmed = AtomicBoolean(false)

    @Volatile
    private var store: SessionIntentStore = InMemorySessionIntentStore

    /** Last stop revision observed when a policy pause began (resume gating). */
    @Volatile
    var stopRevisionAtPause: Int = 0
        private set

    /** Backward-compatible property used by QuickCommandHandler / widgets. */
    val userStopRevision: Int
        get() = userStopRev.get()

    val sessionArmedRevisionValue: Int
        get() = sessionArmedRev.get()

    fun attach(store: SessionIntentStore) {
        this.store = store
        val loaded = store.load()
        userStopRev.set(loaded.userStopRevision.coerceAtLeast(0))
        sessionArmedRev.set(loaded.sessionArmedRevision.coerceAtLeast(0))
        automationArmed.set(loaded.automationArmed)
        // Policy pause is ephemeral — do not revive after process death.
        policyPaused.set(false)
        pauseUntilMs.set(0L)
        stopRevisionAtPause = 0
    }

    /** Test / process-local reset. */
    fun resetForTests() {
        userStopRev.set(0)
        sessionArmedRev.set(0)
        policyPaused.set(false)
        pauseUntilMs.set(0L)
        stopRevisionAtPause = 0
        automationArmed.set(false)
        InMemorySessionIntentStore.clear()
        store = InMemorySessionIntentStore
    }

    fun latchUserStop() {
        userStopRev.incrementAndGet()
        // A permanent Stop cancels any policy resume window.
        policyPaused.set(false)
        pauseUntilMs.set(0L)
        persistNow()
    }

    /**
     * Temporary policy pause. Does **not** increment user-stop revision.
     * @param untilMs exclusive deadline; 0 means indefinite until [clearPolicyPauseIfCurrent] or [armSession]
     */
    fun latchPolicyPause(untilMs: Long = 0L) {
        stopRevisionAtPause = userStopRev.get()
        policyPaused.set(true)
        pauseUntilMs.set(untilMs)
        // Not persisted — safety pause must re-evaluate after restart.
    }

    /** Clear policy pause only if no newer user Stop arrived since pause. */
    fun clearPolicyPauseIfCurrent(): Boolean {
        if (userStopRev.get() > stopRevisionAtPause) {
            policyPaused.set(false)
            pauseUntilMs.set(0L)
            return false
        }
        policyPaused.set(false)
        pauseUntilMs.set(0L)
        return true
    }

    /**
     * Arm after a **validated** Start is about to enqueue work.
     * Clears user-stop relative to current revision; also clears policy pause.
     */
    fun armSession() {
        sessionArmedRev.set(userStopRev.get())
        policyPaused.set(false)
        pauseUntilMs.set(0L)
        persistNow()
    }

    fun isUserStopped(): Boolean = userStopRev.get() > sessionArmedRev.get()

    fun isPolicyPaused(nowMs: Long = System.currentTimeMillis()): Boolean {
        if (!policyPaused.get()) return false
        val until = pauseUntilMs.get()
        if (until <= 0L) return true
        return until > nowMs
    }

    fun policyPauseUntilMs(): Long = pauseUntilMs.get()

    fun isAutomationArmed(): Boolean = automationArmed.get()

    fun setAutomationArmed(armed: Boolean) {
        automationArmed.set(armed)
        persistNow()
    }

    fun snapshot(nowMs: Long = System.currentTimeMillis()): SessionIntentSnapshot {
        val until = pauseUntilMs.get()
        return SessionIntentSnapshot(
            userStopRevision = userStopRev.get(),
            sessionArmedRevision = sessionArmedRev.get(),
            userStopLatched = isUserStopped(),
            automationArmed = automationArmed.get(),
            policyPaused = isPolicyPaused(nowMs),
            policyPauseUntilMs = until.takeIf { it > nowMs },
            stopRevisionAtPause = stopRevisionAtPause
        )
    }

    private fun persistNow() {
        store.save(
            PersistedSessionIntent(
                userStopRevision = userStopRev.get(),
                sessionArmedRevision = sessionArmedRev.get(),
                automationArmed = automationArmed.get()
            )
        )
    }
}

data class SessionIntentSnapshot(
    val userStopRevision: Int,
    val sessionArmedRevision: Int,
    val userStopLatched: Boolean,
    val automationArmed: Boolean,
    val policyPaused: Boolean,
    val policyPauseUntilMs: Long?,
    val stopRevisionAtPause: Int
)

data class PersistedSessionIntent(
    val userStopRevision: Int = 0,
    val sessionArmedRevision: Int = 0,
    /** Defaults false — automation must be explicitly enabled (#123). */
    val automationArmed: Boolean = false
)

interface SessionIntentStore {
    fun load(): PersistedSessionIntent
    fun save(intent: PersistedSessionIntent)
}

object InMemorySessionIntentStore : SessionIntentStore {
    @Volatile
    private var current = PersistedSessionIntent()

    override fun load(): PersistedSessionIntent = current

    override fun save(intent: PersistedSessionIntent) {
        current = intent
    }

    fun clear() {
        current = PersistedSessionIntent()
    }
}
