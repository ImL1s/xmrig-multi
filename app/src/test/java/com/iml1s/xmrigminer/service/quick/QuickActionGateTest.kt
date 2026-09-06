package com.iml1s.xmrigminer.service.quick

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Exported MainActivity start gate (#123).
 * Bare quick_action=start without a consumed token must require confirm — never auto-mine.
 */
class QuickActionGateTest {

    @Before
    fun setUp() {
        QuickStartAuthorization.resetForTests()
    }

    @After
    fun tearDown() {
        QuickStartAuthorization.resetForTests()
    }

    @Test
    fun `external start without token requires confirm`() {
        val d = QuickActionGate.decideStart(
            action = "start",
            authToken = null,
            userStopped = false,
            automationArmed = true,
            nowMs = 10L
        )
        assertEquals(QuickActionGate.StartDisposition.REQUIRE_USER_CONFIRM, d)
    }

    @Test
    fun `forged authorized extra does not auto-start`() {
        val d = QuickActionGate.decideStart(
            action = "start",
            authToken = "authorized=true",
            userStopped = false,
            automationArmed = true,
            nowMs = 10L
        )
        assertEquals(QuickActionGate.StartDisposition.REQUIRE_USER_CONFIRM, d)
    }

    @Test
    fun `issued token auto-starts when automation armed`() {
        val token = QuickStartAuthorization.issue(nowMs = 1L, ttlMs = 60_000L)
        val d = QuickActionGate.decideStart(
            action = "start",
            authToken = token,
            userStopped = false,
            automationArmed = true,
            nowMs = 5L
        )
        assertEquals(QuickActionGate.StartDisposition.AUTHORIZED_AUTO_START, d)
        // Consumed — replay blocked.
        val replay = QuickActionGate.decideStart(
            action = "start",
            authToken = token,
            userStopped = false,
            automationArmed = true,
            nowMs = 6L
        )
        assertEquals(QuickActionGate.StartDisposition.REQUIRE_USER_CONFIRM, replay)
    }

    @Test
    fun `user stop blocks even with valid token`() {
        val token = QuickStartAuthorization.issue(nowMs = 1L, ttlMs = 60_000L)
        val d = QuickActionGate.decideStart(
            action = "start",
            authToken = token,
            userStopped = true,
            automationArmed = true,
            nowMs = 5L
        )
        assertEquals(QuickActionGate.StartDisposition.BLOCKED_USER_STOP, d)
    }

    @Test
    fun `token with automation off is blocked without consuming`() {
        val token = QuickStartAuthorization.issue(nowMs = 1L, ttlMs = 60_000L)
        val d = QuickActionGate.decideStart(
            action = "start",
            authToken = token,
            userStopped = false,
            automationArmed = false,
            nowMs = 5L
        )
        assertEquals(QuickActionGate.StartDisposition.BLOCKED_AUTOMATION_OFF, d)
        // Token still valid for a later retry once automation is enabled.
        assertTrue(QuickStartAuthorization.peekValid(token, nowMs = 6L))
    }
}
